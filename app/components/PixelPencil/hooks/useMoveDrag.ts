import { useCallback, useEffect, useRef } from "react";
import type { RefObject, SetStateAction } from "react";

import type { EditLayer } from "../layer-edit";
import {
  cloneBuffer,
  copyRect,
  copyShiftedRect,
  EMPTY_PIXEL,
  extractRect,
  intersectRect,
  isPaintedPixel,
  nonEmptyBounds,
  unionRect,
  type DirtyRect,
  type PixelBuffer,
} from "../pixel-buffer";
import type { ToolId } from "../PixelPencilTools";
import type { Layer, SelectionState } from "../PixelPencilTypes";
import { areSelectionsEqual, cloneSelection } from "../pixel-operations";
import type { HistoryStacks } from "./useEditorHistory";

type Cell = { x: number; y: number };

/** Bookkeeping for one move-tool drag, from pointer-down until release or cancel. */
export type MoveDrag = {
  pointerId: number;
  /** Layer being moved; the active layer, or the topmost opaque layer under the pointer when auto-pick is on. */
  layerId: string;
  originalActiveLayerId: string;
  origin: Cell;
  delta: { dx: number; dy: number };
  /** A copy of the layer taken at pointer-down, restored on cancel. */
  sourcePixels: PixelBuffer;
  /** The pixels that get translated: the source plus any floating selection pixels. */
  movePixels: PixelBuffer;
  /** Bounds of `movePixels`' non-empty cells, or null when there is nothing to move. */
  sourceBounds: DirtyRect | null;
  /** Bounds of the moved pixels as last written to the layer. */
  lastBounds: DirtyRect | null;
  sourceSelection: SelectionState | null;
  previousHistory: HistoryStacks;
  /** True once the pointer has moved at least one cell and a history action is open. */
  actionStarted: boolean;
};

export type ResolvedMovePointer = { index: number; cellX: number; cellY: number };

export type MoveDragOptions = {
  gridWidth: number;
  gridHeight: number;
  tool: ToolId;
  autoPickLayer: boolean;
  gridRef: RefObject<HTMLCanvasElement | null>;
  layersRef: RefObject<Layer[]>;
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  selectionRef: RefObject<SelectionState | null>;
  setSelection: (next: SetStateAction<SelectionState | null>) => SelectionState | null;
  resolvePointerFromClientPoint: (
    clientX: number,
    clientY: number,
    options?: { clamp?: boolean },
  ) => ResolvedMovePointer | null;
  /** Writes to a layer through the editor, which records history and recomposites. */
  editLayer: EditLayer;
  /** The live buffer of a layer, or null when it is gone. */
  getLayerBuffer: (layerId: string) => PixelBuffer | null;
  saveStacks: () => HistoryStacks;
  restoreStacks: (stacks: HistoryStacks) => void;
  beginAction: () => void;
  finalizeAction: () => void;
};

export type MoveDragApi = {
  /** True while a move drag is in progress. */
  hasActiveDrag: () => boolean;
  /** Move-tool pointer-down on the canvas at a resolved cell. */
  beginMoveDrag: (canvas: HTMLCanvasElement, pointerId: number, resolved: ResolvedMovePointer) => void;
  /** Moves the dragged layer and selection to follow the pointer; opens the history action on the first real movement. */
  updateMoveDrag: (clientX: number, clientY: number, pointerId: number) => void;
  /** Ends the drag: cancelled or unchanged drags restore the layer, selection and history stacks. Returns whether it handled the pointer. */
  finishMoveDrag: (pointerId: number, cancelled: boolean) => boolean;
};

const shiftRect = (rect: DirtyRect | null, dx: number, dy: number, grid: DirtyRect) =>
  rect ? intersectRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, grid) : null;

/**
 * The move tool's drag: translating a layer (and any selection on it) with
 * the pointer. The layer is copied once at pointer-down; each step writes the
 * copy, shifted by the drag delta, into the layer over only the union of where
 * the pixels started, where they were last drawn, and where they are now, so a
 * step costs that union rather than the canvas. The
 * history action opens only once the pointer has moved, and the stacks roll
 * back when the drag is cancelled or ends where it started. While the move
 * tool is active it also listens on the window so a drag completes outside
 * the canvas.
 */
export function useMoveDrag({
  gridWidth,
  gridHeight,
  tool,
  autoPickLayer,
  gridRef,
  layersRef,
  activeLayerId,
  setActiveLayerId,
  selectionRef,
  setSelection,
  resolvePointerFromClientPoint,
  editLayer,
  getLayerBuffer,
  saveStacks,
  restoreStacks,
  beginAction,
  finalizeAction,
}: MoveDragOptions): MoveDragApi {
  const moveDragRef = useRef<MoveDrag | null>(null);

  const hasActiveDrag = useCallback(() => moveDragRef.current !== null, []);

  /** Copies `source` shifted by (dx, dy) over `rect` of the dragged layer through `editLayer`. */
  const writeLayer = useCallback(
    (layerId: string, source: PixelBuffer, rect: DirtyRect | null, dx = 0, dy = 0) => {
      if (!rect) return;
      editLayer(layerId, rect, (buffer) => {
        if (dx === 0 && dy === 0) copyRect(source, buffer, rect);
        else copyShiftedRect(source, buffer, rect, dx, dy);
        return rect;
      });
    },
    [editLayer],
  );

  const beginMoveDrag = useCallback(
    (canvas: HTMLCanvasElement, pointerId: number, resolved: ResolvedMovePointer) => {
      const currentSelection = cloneSelection(selectionRef.current);
      let targetLayer = layersRef.current.find((layer) => layer.id === activeLayerId);
      if (autoPickLayer && !currentSelection) {
        for (let layerIndex = layersRef.current.length - 1; layerIndex >= 0; layerIndex -= 1) {
          const candidate = layersRef.current[layerIndex];
          if (candidate.visible && isPaintedPixel(candidate.pixels.data[resolved.index])) {
            targetLayer = candidate;
            break;
          }
        }
      }
      if (!targetLayer) return;
      const layerBuffer = getLayerBuffer(targetLayer.id);
      if (!layerBuffer) return;
      const sourcePixels = cloneBuffer(layerBuffer);
      const movePixels = cloneBuffer(sourcePixels);
      if (currentSelection?.isFloating) {
        const { rect, offset, data } = currentSelection;
        for (let relY = 0; relY < rect.height; relY += 1) {
          const y = rect.y + offset.dy + relY;
          if (y < 0 || y >= movePixels.height) continue;
          for (let relX = 0; relX < rect.width; relX += 1) {
            const x = rect.x + offset.dx + relX;
            if (x < 0 || x >= movePixels.width) continue;
            const value = data[relY * rect.width + relX];
            if (value !== EMPTY_PIXEL) movePixels.data[y * movePixels.width + x] = value;
          }
        }
      }
      if (targetLayer.id !== activeLayerId) {
        setActiveLayerId(targetLayer.id);
      }
      const sourceBounds = nonEmptyBounds(movePixels);
      moveDragRef.current = {
        pointerId,
        layerId: targetLayer.id,
        originalActiveLayerId: activeLayerId,
        origin: { x: resolved.cellX, y: resolved.cellY },
        delta: { dx: 0, dy: 0 },
        sourcePixels,
        movePixels,
        sourceBounds,
        lastBounds: sourceBounds,
        sourceSelection: currentSelection,
        previousHistory: saveStacks(),
        actionStarted: false,
      };
      try {
        canvas.setPointerCapture(pointerId);
      } catch {
        // Window pointer listeners still complete the drag if capture fails.
      }
    },
    [activeLayerId, autoPickLayer, getLayerBuffer, layersRef, saveStacks, selectionRef, setActiveLayerId],
  );

  const updateMoveDrag = useCallback((clientX: number, clientY: number, pointerId: number) => {
    const drag = moveDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const resolved = resolvePointerFromClientPoint(clientX, clientY, { clamp: true });
    if (!resolved) return;
    const dx = resolved.cellX - drag.origin.x;
    const dy = resolved.cellY - drag.origin.y;
    if (dx === drag.delta.dx && dy === drag.delta.dy) return;
    if (!drag.actionStarted) {
      if (dx === 0 && dy === 0) return;
      beginAction();
      drag.actionStarted = true;
    }
    drag.delta = { dx, dy };
    const grid = { x: 0, y: 0, width: drag.movePixels.width, height: drag.movePixels.height };
    const atOrigin = dx === 0 && dy === 0;
    const shiftedBounds = shiftRect(drag.sourceBounds, dx, dy, grid);
    const union = unionRect(unionRect(drag.sourceBounds, drag.lastBounds), shiftedBounds);
    const rect = union ? intersectRect(union, grid) : null;
    if (atOrigin) {
      // Back at the origin the layer shows its untouched source, without floating pixels stamped in.
      writeLayer(drag.layerId, drag.sourcePixels, rect);
    } else {
      writeLayer(drag.layerId, drag.movePixels, rect, dx, dy);
    }
    drag.lastBounds = shiftedBounds;

    let nextSelection: SelectionState | null = null;
    if (drag.sourceSelection) {
      if (atOrigin) {
        nextSelection = cloneSelection(drag.sourceSelection);
      } else {
        const sourceRect = drag.sourceSelection.rect;
        const shifted = intersectRect(
          {
            x: sourceRect.x + drag.sourceSelection.offset.dx + dx,
            y: sourceRect.y + drag.sourceSelection.offset.dy + dy,
            width: sourceRect.width,
            height: sourceRect.height,
          },
          { x: 0, y: 0, width: gridWidth, height: gridHeight },
        );
        // The layer now holds the moved pixels, so the selection reads its cells from it.
        const layerBuffer = getLayerBuffer(drag.layerId);
        if (shifted && layerBuffer) {
          nextSelection = {
            rect: shifted,
            offset: { dx: 0, dy: 0 },
            data: extractRect(layerBuffer, shifted),
            isFloating: false,
          };
        }
      }
    }
    setSelection(nextSelection);
  }, [beginAction, getLayerBuffer, gridHeight, gridWidth, resolvePointerFromClientPoint, setSelection, writeLayer]);

  const finishMoveDrag = useCallback((pointerId: number, cancelled: boolean) => {
    const drag = moveDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return false;
    moveDragRef.current = null;
    const canvas = gridRef.current;
    if (canvas?.hasPointerCapture?.(pointerId)) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // The browser may have already released capture.
      }
    }
    // Back at the origin the layer holds its source again, so only the selection can differ.
    const atOrigin = drag.delta.dx === 0 && drag.delta.dy === 0;
    const changed = drag.actionStarted && (
      !atOrigin || !areSelectionsEqual(selectionRef.current, drag.sourceSelection)
    );
    if (cancelled || !changed) {
      if (drag.actionStarted) {
        writeLayer(drag.layerId, drag.sourcePixels, unionRect(drag.sourceBounds, drag.lastBounds));
        setSelection(cloneSelection(drag.sourceSelection));
        restoreStacks(drag.previousHistory);
      }
      if (cancelled && drag.originalActiveLayerId !== drag.layerId) {
        if (layersRef.current.some((layer) => layer.id === drag.originalActiveLayerId)) {
          setActiveLayerId(drag.originalActiveLayerId);
        }
      }
    } else {
      finalizeAction();
    }
    return true;
  }, [finalizeAction, gridRef, layersRef, restoreStacks, selectionRef, setActiveLayerId, setSelection, writeLayer]);

  useEffect(() => {
    if (tool !== "move") {
      const drag = moveDragRef.current;
      if (drag) finishMoveDrag(drag.pointerId, true);
      return;
    }
    const onMove = (event: PointerEvent) => {
      updateMoveDrag(event.clientX, event.clientY, event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      updateMoveDrag(event.clientX, event.clientY, event.pointerId);
      finishMoveDrag(event.pointerId, false);
    };
    const onCancel = (event: PointerEvent) => finishMoveDrag(event.pointerId, true);
    const onBlur = () => {
      const drag = moveDragRef.current;
      if (drag) finishMoveDrag(drag.pointerId, true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
    };
  }, [finishMoveDrag, tool, updateMoveDrag]);

  return { hasActiveDrag, beginMoveDrag, updateMoveDrag, finishMoveDrag };
}
