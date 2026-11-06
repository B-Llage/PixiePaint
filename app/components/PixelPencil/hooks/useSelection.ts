import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import type { EditLayer } from "../layer-edit";
import { EMPTY_PIXEL, extractRect, intersectRect, type PixelBuffer } from "../pixel-buffer";
import type { ToolId } from "../PixelPencilTools";
import type { Layer, SelectionRect, SelectionState } from "../PixelPencilTypes";
import { cloneSelection, hasSelectionPixels } from "../pixel-operations";
import { useStateWithRef } from "./useStateWithRef";

type Cell = { x: number; y: number };
type Offset = { dx: number; dy: number };

/**
 * Mutable bookkeeping for the rect-select pointer gesture. It is a single
 * ref because handlers read and write several fields together and none of
 * them is rendered.
 */
export type SelectionGesture = {
  /** Cell where a new rectangle drag started, while one is being drawn. */
  draftOrigin: Cell | null;
  /** Pointer cell and starting offset while an existing selection is being dragged. */
  move: { pointer: Cell; startOffset: Offset } | null;
  /** Last cell the drawing drag reached, used when pointer-up lands off-canvas. */
  lastPointerCell: Cell | null;
  /** True while a selection drag has a history action open. */
  actionActive: boolean;
  /** Pointer captured by the canvas for the gesture. */
  pointerId: number | null;
  /** True when the pointer-down cancelled a previous selection, so a click does not create a 1x1 one. */
  cancelClick: boolean;
};

export type SelectionStateOptions = {
  gridWidth: number;
  gridHeight: number;
  gridRef: RefObject<HTMLCanvasElement | null>;
  /** The active layer, read when a selection captures pixels. */
  getActiveLayer: () => Layer | null;
  /** The layer `applySelectionToLayer` writes to. */
  activeLayerId: string;
  /** Writes to a layer through the editor, which records history and recomposites. */
  editLayer: EditLayer;
  setPathPreview: Dispatch<SetStateAction<Set<number> | null>>;
};

export type SelectionStateApi = {
  selection: SelectionState | null;
  setSelection: (next: SetStateAction<SelectionState | null>) => SelectionState | null;
  selectionRef: RefObject<SelectionState | null>;
  selectionPreviewRect: SelectionRect | null;
  setSelectionPreviewRect: Dispatch<SetStateAction<SelectionRect | null>>;
  gestureRef: RefObject<SelectionGesture>;
  normalizeSelectionRect: (start: Cell, end: Cell) => SelectionRect;
  selectionContainsCell: (sel: SelectionState, cellX: number, cellY: number) => boolean;
  clampSelectionOffset: (rect: SelectionRect, desired: Offset) => Offset;
  /**
   * Copies the cells under `rect` from `source` (the active layer by default) as `rect.width *
   * rect.height` row-major values. Cells outside the grid come back empty.
   */
  captureSelectionPixels: (rect: SelectionRect, source?: PixelBuffer) => Uint32Array;
  /**
   * Writes (`apply`) or erases (`clear`) the selection's non-empty cells on the active layer at
   * `offset`, in one `editLayer` call bounded by the shifted rect clipped to the grid.
   */
  applySelectionToLayer: (target: SelectionState, offset: Offset, mode: "apply" | "clear") => void;
  clearSelectionState: () => void;
  releaseSelectionPointerCapture: (pointerId?: number | null) => void;
  /** Replaces the selection from a history snapshot and abandons any gesture in progress. */
  restoreSelection: (selection: SelectionState | null) => void;
  /** Commits a floating selection to the layer and drops its offset into its rect. */
  finalizeSelectionMove: () => void;
};

/**
 * Selection state, the gesture bookkeeping, and the pure-ish helpers around
 * them. It has no dependency on history, so the editor can build history
 * snapshots from `selectionRef` and restore them with `restoreSelection`
 * before `useSelectionGestures` wires the gestures to history actions.
 */
export function useSelectionState({
  gridWidth,
  gridHeight,
  gridRef,
  getActiveLayer,
  activeLayerId,
  editLayer,
  setPathPreview,
}: SelectionStateOptions): SelectionStateApi {
  const [selection, setSelection, selectionRef] = useStateWithRef<SelectionState | null>(null);
  const [selectionPreviewRect, setSelectionPreviewRect] = useState<SelectionRect | null>(null);
  const gestureRef = useRef<SelectionGesture>({
    draftOrigin: null,
    move: null,
    lastPointerCell: null,
    actionActive: false,
    pointerId: null,
    cancelClick: false,
  });

  const clampCellX = useCallback(
    (value: number) => Math.max(0, Math.min(gridWidth - 1, value)),
    [gridWidth],
  );

  const clampCellY = useCallback(
    (value: number) => Math.max(0, Math.min(gridHeight - 1, value)),
    [gridHeight],
  );

  const normalizeSelectionRect = useCallback(
    (start: Cell, end: Cell): SelectionRect => {
      const startX = clampCellX(start.x);
      const startY = clampCellY(start.y);
      const endX = clampCellX(end.x);
      const endY = clampCellY(end.y);
      const minX = Math.min(startX, endX);
      const minY = Math.min(startY, endY);
      const maxX = Math.max(startX, endX);
      const maxY = Math.max(startY, endY);
      const width = Math.min(maxX - minX + 1, gridWidth - minX);
      const height = Math.min(maxY - minY + 1, gridHeight - minY);
      return {
        x: minX,
        y: minY,
        width: Math.max(1, width),
        height: Math.max(1, height),
      };
    },
    [clampCellX, clampCellY, gridHeight, gridWidth],
  );

  const selectionContainsCell = useCallback(
    (sel: SelectionState, cellX: number, cellY: number) => {
      const left = sel.rect.x + sel.offset.dx;
      const top = sel.rect.y + sel.offset.dy;
      return (
        cellX >= left &&
        cellX < left + sel.rect.width &&
        cellY >= top &&
        cellY < top + sel.rect.height
      );
    },
    [],
  );

  const clampSelectionOffset = useCallback(
    (rect: SelectionRect, desired: Offset) => {
      const minDx = -(rect.x + rect.width - 1);
      const maxDx = gridWidth - 1 - rect.x;
      const minDy = -(rect.y + rect.height - 1);
      const maxDy = gridHeight - 1 - rect.y;
      return {
        dx: Math.min(Math.max(desired.dx, minDx), maxDx),
        dy: Math.min(Math.max(desired.dy, minDy), maxDy),
      };
    },
    [gridHeight, gridWidth],
  );

  const captureSelectionPixels = useCallback(
    (rect: SelectionRect, source?: PixelBuffer): Uint32Array => {
      const buffer = source ?? getActiveLayer()?.pixels;
      const result = new Uint32Array(rect.width * rect.height);
      if (!buffer) return result;
      const inside = intersectRect(rect, { x: 0, y: 0, width: buffer.width, height: buffer.height });
      if (!inside) return result;
      const isWholeRect = inside.width === rect.width && inside.height === rect.height;
      if (isWholeRect) return extractRect(buffer, rect);
      const clipped = extractRect(buffer, inside);
      for (let row = 0; row < inside.height; row += 1) {
        result.set(
          clipped.subarray(row * inside.width, (row + 1) * inside.width),
          (inside.y - rect.y + row) * rect.width + (inside.x - rect.x),
        );
      }
      return result;
    },
    [getActiveLayer],
  );

  const applySelectionToLayer = useCallback(
    (target: SelectionState, offset: Offset, mode: "apply" | "clear") => {
      if (!hasSelectionPixels(target)) return;
      const left = target.rect.x + offset.dx;
      const top = target.rect.y + offset.dy;
      const rect = intersectRect(
        { x: left, y: top, width: target.rect.width, height: target.rect.height },
        { x: 0, y: 0, width: gridWidth, height: gridHeight },
      );
      if (!rect) return;
      editLayer(activeLayerId, rect, (buffer) => {
        const { data } = buffer;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let y = rect.y; y < rect.y + rect.height; y += 1) {
          const sourceRow = (y - top) * target.rect.width - left;
          for (let x = rect.x; x < rect.x + rect.width; x += 1) {
            const value = target.data[sourceRow + x];
            if (value === EMPTY_PIXEL) continue;
            const nextValue = mode === "clear" ? EMPTY_PIXEL : value;
            const index = y * buffer.width + x;
            if (data[index] === nextValue) continue;
            data[index] = nextValue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (maxX < minX) return null;
        return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
      });
    },
    [activeLayerId, editLayer, gridHeight, gridWidth],
  );

  const clearSelectionState = useCallback(() => {
    setSelection(null);
    setSelectionPreviewRect(null);
    setPathPreview(null);
  }, [setPathPreview, setSelection]);

  const releaseSelectionPointerCapture = useCallback(
    (pointerId?: number | null) => {
      const activePointerId = gestureRef.current.pointerId;
      if (activePointerId === null) return;
      if (typeof pointerId === "number" && pointerId !== activePointerId) {
        return;
      }
      const canvas = gridRef.current;
      if (
        canvas &&
        typeof canvas.releasePointerCapture === "function" &&
        canvas.hasPointerCapture?.(activePointerId)
      ) {
        try {
          canvas.releasePointerCapture(activePointerId);
        } catch {
          // ignore release failures
        }
      }
      gestureRef.current.pointerId = null;
    },
    [gridRef],
  );

  const restoreSelection = useCallback(
    (next: SelectionState | null) => {
      setSelection(cloneSelection(next));
      setSelectionPreviewRect(null);
      const gesture = gestureRef.current;
      gesture.draftOrigin = null;
      gesture.move = null;
      gesture.lastPointerCell = null;
      gesture.actionActive = false;
      gesture.cancelClick = false;
      releaseSelectionPointerCapture();
    },
    [releaseSelectionPointerCapture, setSelection],
  );

  const finalizeSelectionMove = useCallback(() => {
    setSelection((current) => {
      if (!current || !current.isFloating) {
        return current;
      }
      applySelectionToLayer(current, current.offset, "apply");
      return {
        ...current,
        rect: {
          ...current.rect,
          x: current.rect.x + current.offset.dx,
          y: current.rect.y + current.offset.dy,
        },
        offset: { dx: 0, dy: 0 },
        isFloating: false,
      };
    });
  }, [applySelectionToLayer, setSelection]);

  return {
    selection,
    setSelection,
    selectionRef,
    selectionPreviewRect,
    setSelectionPreviewRect,
    gestureRef,
    normalizeSelectionRect,
    selectionContainsCell,
    clampSelectionOffset,
    captureSelectionPixels,
    applySelectionToLayer,
    clearSelectionState,
    releaseSelectionPointerCapture,
    restoreSelection,
    finalizeSelectionMove,
  };
}

export type SelectionGesturesOptions = {
  state: SelectionStateApi;
  tool: ToolId;
  gridWidth: number;
  gridHeight: number;
  /** The grid's wrapper; a pointer-down outside it cancels the selection. */
  gridWrapperRef: RefObject<HTMLDivElement | null>;
  setPathPreview: Dispatch<SetStateAction<Set<number> | null>>;
  /** Converts a client point to a clamped grid cell, or null when the canvas is not ready. */
  resolvePointerFromClientPoint: (
    clientX: number,
    clientY: number,
    options?: { clamp?: boolean },
  ) => { cellX: number; cellY: number } | null;
  beginAction: () => void;
  finalizeAction: () => void;
};

export type SelectionGesturesApi = {
  /** Commits a floating selection and clears it. Returns whether there was anything to cancel. */
  cancelSelection: () => boolean;
  selectEntireCanvas: () => void;
  deleteSelection: () => void;
  /** Rect-select pointer-down on the canvas at a resolved cell: starts a drag of the selection or a new rectangle. */
  beginRectSelectGesture: (
    canvas: HTMLCanvasElement,
    pointerId: number,
    cellX: number,
    cellY: number,
  ) => void;
  /** Pointer-down on the grid background outside the artwork. */
  handleSelectionBackgroundPointerDown: (event: {
    preventDefault: () => void;
  }) => void;
  /** Finishes a rectangle draw or selection drag on pointer-up. Returns whether it handled the event. */
  finalizeRectSelectionPointerUp: (eventData: {
    clientX: number;
    clientY: number;
    pointerId?: number | null;
  }) => boolean;
  /** Updates the rectangle preview or the dragged selection's offset. Returns whether it handled the point. */
  updateRectSelectionFromClientPoint: (clientX: number, clientY: number) => boolean;
};

/**
 * Rect-select gestures and their window-level listeners, wired to history
 * actions. Dragging a selection with pixels opens an action before lifting
 * the pixels off the layer and closes it when the drag ends or is cancelled.
 */
export function useSelectionGestures({
  state,
  tool,
  gridWidth,
  gridHeight,
  gridWrapperRef,
  setPathPreview,
  resolvePointerFromClientPoint,
  beginAction,
  finalizeAction,
}: SelectionGesturesOptions): SelectionGesturesApi {
  const {
    setSelection,
    selectionRef,
    setSelectionPreviewRect,
    gestureRef,
    normalizeSelectionRect,
    selectionContainsCell,
    clampSelectionOffset,
    captureSelectionPixels,
    applySelectionToLayer,
    clearSelectionState,
    releaseSelectionPointerCapture,
    finalizeSelectionMove,
  } = state;

  const clampCellX = useCallback(
    (value: number) => Math.max(0, Math.min(gridWidth - 1, value)),
    [gridWidth],
  );

  const clampCellY = useCallback(
    (value: number) => Math.max(0, Math.min(gridHeight - 1, value)),
    [gridHeight],
  );

  const cancelSelection = useCallback(() => {
    const gesture = gestureRef.current;
    const hadDraft = gesture.draftOrigin !== null;
    if (gesture.draftOrigin) {
      gesture.draftOrigin = null;
    }
    if (gesture.move) {
      gesture.move = null;
    }
    gesture.lastPointerCell = null;
    const current = selectionRef.current;
    if (!current && !hadDraft) {
      return false;
    }
    if (current?.isFloating) {
      applySelectionToLayer(current, current.offset, "apply");
    }
    clearSelectionState();
    releaseSelectionPointerCapture();
    if (gesture.actionActive) {
      finalizeAction();
      gesture.actionActive = false;
    }
    gesture.cancelClick = false;
    return true;
  }, [applySelectionToLayer, clearSelectionState, finalizeAction, gestureRef, releaseSelectionPointerCapture, selectionRef]);

  const selectEntireCanvas = useCallback(() => {
    if (gridWidth <= 0 || gridHeight <= 0) {
      return;
    }
    cancelSelection();
    const rect: SelectionRect = {
      x: 0,
      y: 0,
      width: gridWidth,
      height: gridHeight,
    };
    const data = captureSelectionPixels(rect);
    setSelection({
      rect,
      offset: { dx: 0, dy: 0 },
      data,
      isFloating: false,
    });
    setSelectionPreviewRect(null);
    setPathPreview(null);
  }, [cancelSelection, captureSelectionPixels, gridHeight, gridWidth, setPathPreview, setSelection, setSelectionPreviewRect]);

  const deleteSelection = useCallback(() => {
    const current = selectionRef.current;
    if (!current) return;
    const hasPixels = hasSelectionPixels(current);
    if (!current.isFloating && hasPixels) {
      beginAction();
      applySelectionToLayer(current, current.offset, "clear");
      finalizeAction();
    } else if (current.isFloating && hasPixels) {
      beginAction();
      finalizeAction();
    }
    clearSelectionState();
  }, [applySelectionToLayer, beginAction, clearSelectionState, finalizeAction, selectionRef]);

  const beginRectSelectGesture = useCallback(
    (canvas: HTMLCanvasElement, pointerId: number, cellX: number, cellY: number) => {
      const gesture = gestureRef.current;
      const activeSelection = selectionRef.current;

      if (activeSelection && selectionContainsCell(activeSelection, cellX, cellY)) {
        if (typeof canvas.setPointerCapture === "function") {
          try {
            canvas.setPointerCapture(pointerId);
            gesture.pointerId = pointerId;
          } catch {
            gesture.pointerId = null;
          }
        }
        gesture.draftOrigin = null;
        gesture.move = {
          pointer: { x: cellX, y: cellY },
          startOffset: activeSelection.offset,
        };
        if (hasSelectionPixels(activeSelection)) {
          beginAction();
          gesture.actionActive = true;
          if (!activeSelection.isFloating) {
            applySelectionToLayer(activeSelection, activeSelection.offset, "clear");
            setSelection((prev) =>
              prev
                ? {
                  ...prev,
                  offset: { dx: 0, dy: 0 },
                  isFloating: true,
                }
                : prev,
            );
          }
        }
        return;
      }

      if (activeSelection && !selectionContainsCell(activeSelection, cellX, cellY)) {
        cancelSelection();
        gesture.cancelClick = true;
      } else {
        gesture.cancelClick = false;
      }

      if (typeof canvas.setPointerCapture === "function") {
        try {
          canvas.setPointerCapture(pointerId);
          gesture.pointerId = pointerId;
        } catch {
          gesture.pointerId = null;
        }
      }

      gesture.move = null;
      gesture.draftOrigin = {
        x: clampCellX(cellX),
        y: clampCellY(cellY),
      };
      gesture.lastPointerCell = {
        x: gesture.draftOrigin.x,
        y: gesture.draftOrigin.y,
      };
      clearSelectionState();
      const initialRect = {
        x: gesture.draftOrigin.x,
        y: gesture.draftOrigin.y,
        width: 1,
        height: 1,
      };
      setSelectionPreviewRect(initialRect);
      setPathPreview(null);
    },
    [
      applySelectionToLayer,
      beginAction,
      cancelSelection,
      clampCellX,
      clampCellY,
      clearSelectionState,
      gestureRef,
      selectionContainsCell,
      selectionRef,
      setPathPreview,
      setSelection,
      setSelectionPreviewRect,
    ],
  );

  const handleSelectionBackgroundPointerDown = useCallback(
    (event: { preventDefault: () => void }) => {
      if (tool === "move") return;
      const gesture = gestureRef.current;
      if (!selectionRef.current && !gesture.draftOrigin && !gesture.move) {
        return;
      }
      event.preventDefault();
      gesture.cancelClick = true;
      cancelSelection();
    },
    [cancelSelection, gestureRef, selectionRef, tool],
  );

  const finalizeRectSelectionPointerUp = useCallback(
    (eventData: { clientX: number; clientY: number; pointerId?: number | null }) => {
      if (tool !== "rect-select") return false;
      const gesture = gestureRef.current;
      const draftStart = gesture.draftOrigin;
      let handled = false;
      if (draftStart) {
        const resolved = resolvePointerFromClientPoint(eventData.clientX, eventData.clientY, {
          clamp: true,
        });
        const fallback = gesture.lastPointerCell ?? draftStart;
        const endCell = resolved
          ? { x: resolved.cellX, y: resolved.cellY }
          : fallback;
        const rect = normalizeSelectionRect(draftStart, endCell);
        gesture.draftOrigin = null;
        gesture.lastPointerCell = null;
        setSelectionPreviewRect(null);
        setPathPreview(null);
        if (gesture.cancelClick) {
          gesture.cancelClick = false;
        } else {
          const data = captureSelectionPixels(rect);
          setSelection({
            rect,
            offset: { dx: 0, dy: 0 },
            data,
            isFloating: false,
          });
        }
        handled = true;
      } else if (gesture.move) {
        gesture.move = null;
        finalizeSelectionMove();
        if (gesture.actionActive) {
          finalizeAction();
          gesture.actionActive = false;
        }
        setPathPreview(null);
        gesture.cancelClick = false;
        handled = true;
      }
      if (handled) {
        releaseSelectionPointerCapture(eventData.pointerId ?? null);
      }
      return handled;
    },
    [
      captureSelectionPixels,
      finalizeAction,
      finalizeSelectionMove,
      gestureRef,
      normalizeSelectionRect,
      releaseSelectionPointerCapture,
      resolvePointerFromClientPoint,
      setPathPreview,
      setSelection,
      setSelectionPreviewRect,
      tool,
    ],
  );

  const updateRectSelectionFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (tool !== "rect-select") return false;
      const resolved = resolvePointerFromClientPoint(clientX, clientY, {
        clamp: true,
      });
      if (!resolved) return false;
      const gesture = gestureRef.current;
      if (gesture.draftOrigin) {
        gesture.lastPointerCell = {
          x: resolved.cellX,
          y: resolved.cellY,
        };
        const rect = normalizeSelectionRect(gesture.draftOrigin, {
          x: resolved.cellX,
          y: resolved.cellY,
        });
        if (
          gesture.cancelClick &&
          (rect.x !== gesture.draftOrigin.x ||
            rect.y !== gesture.draftOrigin.y ||
            rect.width > 1 ||
            rect.height > 1)
        ) {
          gesture.cancelClick = false;
        }
        setSelectionPreviewRect(rect);
        setPathPreview(null);
      } else if (gesture.move && selectionRef.current) {
        const activeSelection = selectionRef.current;
        const deltaX = resolved.cellX - gesture.move.pointer.x;
        const deltaY = resolved.cellY - gesture.move.pointer.y;
        const desired = {
          dx: gesture.move.startOffset.dx + deltaX,
          dy: gesture.move.startOffset.dy + deltaY,
        };
        const clamped = clampSelectionOffset(activeSelection.rect, desired);
        setSelection((prev) =>
          prev ? { ...prev, offset: clamped } : prev,
        );
      }
      return true;
    },
    [
      clampSelectionOffset,
      gestureRef,
      normalizeSelectionRect,
      resolvePointerFromClientPoint,
      selectionRef,
      setPathPreview,
      setSelection,
      setSelectionPreviewRect,
      tool,
    ],
  );

  // Leaving the rect-select tool releases the canvas pointer capture.
  useEffect(() => {
    if (tool === "rect-select" || gestureRef.current.pointerId === null) {
      return;
    }
    releaseSelectionPointerCapture();
  }, [gestureRef, releaseSelectionPointerCapture, tool]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox"
      );
    };

    const handleSelectionKeys = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "delete" || key === "backspace") {
        if (selectionRef.current) {
          event.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (key === "escape") {
        const gesture = gestureRef.current;
        if (selectionRef.current || gesture.draftOrigin || gesture.move) {
          event.preventDefault();
          cancelSelection();
        }
        return;
      }
      if (key === "a" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        selectEntireCanvas();
      }
    };
    window.addEventListener("keydown", handleSelectionKeys);
    return () => window.removeEventListener("keydown", handleSelectionKeys);
  }, [cancelSelection, deleteSelection, gestureRef, selectEntireCanvas, selectionRef]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleGlobalSelectionPointerUp = (clientX: number, clientY: number, pointerId: number | null) => {
      const gesture = gestureRef.current;
      if (gesture.draftOrigin === null && gesture.move === null) {
        return;
      }
      if (
        gesture.pointerId !== null &&
        pointerId !== null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      finalizeRectSelectionPointerUp({
        clientX,
        clientY,
        pointerId,
      });
    };
    const supportsPointerEvents =
      typeof window.PointerEvent !== "undefined";
    if (supportsPointerEvents) {
      const pointerListener = (event: PointerEvent) => {
        handleGlobalSelectionPointerUp(event.clientX, event.clientY, event.pointerId);
      };
      window.addEventListener("pointerup", pointerListener);
      return () => window.removeEventListener("pointerup", pointerListener);
    }
    const mouseListener = (event: MouseEvent) => {
      handleGlobalSelectionPointerUp(event.clientX, event.clientY, null);
    };
    const touchListener = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      handleGlobalSelectionPointerUp(touch.clientX, touch.clientY, null);
    };
    window.addEventListener("mouseup", mouseListener);
    window.addEventListener("touchend", touchListener);
    window.addEventListener("touchcancel", touchListener);
    return () => {
      window.removeEventListener("mouseup", mouseListener);
      window.removeEventListener("touchend", touchListener);
      window.removeEventListener("touchcancel", touchListener);
    };
  }, [finalizeRectSelectionPointerUp, gestureRef]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleMove = (clientX: number, clientY: number, pointerId: number | null) => {
      if (tool !== "rect-select") return;
      const gesture = gestureRef.current;
      if (gesture.draftOrigin === null && gesture.move === null) {
        return;
      }
      if (
        gesture.pointerId !== null &&
        pointerId !== null &&
        pointerId !== gesture.pointerId
      ) {
        return;
      }
      updateRectSelectionFromClientPoint(clientX, clientY);
    };
    const supportsPointerEvents =
      typeof window.PointerEvent !== "undefined";
    if (supportsPointerEvents) {
      const pointerListener = (event: PointerEvent) => {
        handleMove(event.clientX, event.clientY, event.pointerId);
      };
      window.addEventListener("pointermove", pointerListener);
      return () => window.removeEventListener("pointermove", pointerListener);
    }
    const mouseListener = (event: MouseEvent) => {
      handleMove(event.clientX, event.clientY, null);
    };
    const touchListener = (event: TouchEvent) => {
      const gesture = gestureRef.current;
      if (gesture.draftOrigin === null && gesture.move === null) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      handleMove(touch.clientX, touch.clientY, null);
    };
    window.addEventListener("mousemove", mouseListener);
    window.addEventListener("touchmove", touchListener, { passive: false });
    return () => {
      window.removeEventListener("mousemove", mouseListener);
      window.removeEventListener("touchmove", touchListener);
    };
  }, [gestureRef, tool, updateRectSelectionFromClientPoint]);

  // A pointer-down outside the grid wrapper (but not on a tool control) cancels the selection.
  useEffect(() => {
    const handleGlobalPointerDown = (event: PointerEvent) => {
      const wrapper = gridWrapperRef.current;
      if (!wrapper) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element && target.closest("[data-pixel-tool], [data-tool-settings]")) return;
      if (!wrapper.contains(target)) {
        cancelSelection();
      }
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => {
      window.removeEventListener("pointerdown", handleGlobalPointerDown);
    };
  }, [cancelSelection, gridWrapperRef]);

  return {
    cancelSelection,
    selectEntireCanvas,
    deleteSelection,
    beginRectSelectGesture,
    handleSelectionBackgroundPointerDown,
    finalizeRectSelectionPointerUp,
    updateRectSelectionFromClientPoint,
  };
}
