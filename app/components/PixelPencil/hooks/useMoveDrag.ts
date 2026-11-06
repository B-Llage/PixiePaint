import { useCallback, useEffect, useRef } from "react";
import type { RefObject, SetStateAction } from "react";

import type { ToolId } from "../PixelPencilTools";
import type { Layer, PixelValue, SelectionPixel, SelectionRect, SelectionState } from "../PixelPencilTypes";
import {
  arePixelsEqual,
  areSelectionsEqual,
  cloneLayers,
  cloneSelection,
  translatePixels,
} from "../pixel-operations";
import type { HistoryStacks, LayerSnapshot } from "./useEditorHistory";

type Cell = { x: number; y: number };

/** Bookkeeping for one move-tool drag, from pointer-down until release or cancel. */
export type MoveDrag = {
  pointerId: number;
  /** Layer being moved; the active layer, or the topmost opaque layer under the pointer when auto-pick is on. */
  layerId: string;
  originalActiveLayerId: string;
  origin: Cell;
  delta: { dx: number; dy: number };
  /** The layer's pixels before the drag, restored on cancel. */
  sourcePixels: PixelValue[];
  /** The pixels that get translated: the source plus any floating selection pixels. */
  movePixels: PixelValue[];
  sourceSelection: SelectionState | null;
  previousHistory: HistoryStacks;
  /** True once the pointer has moved at least one cell and a history action is open. */
  actionStarted: boolean;
};

export type ResolvedMovePointer = { index: number; cellX: number; cellY: number };

export type MoveDragOptions = {
  gridWidth: number;
  gridHeight: number;
  totalCells: number;
  tool: ToolId;
  autoPickLayer: boolean;
  gridRef: RefObject<HTMLCanvasElement | null>;
  layersRef: RefObject<Layer[]>;
  setLayers: (next: SetStateAction<Layer[]>) => Layer[];
  activeLayerId: string;
  setActiveLayerId: (id: string) => void;
  setActiveLayerPixelsState: (next: SetStateAction<PixelValue[]>) => PixelValue[];
  selectionRef: RefObject<SelectionState | null>;
  setSelection: (next: SetStateAction<SelectionState | null>) => SelectionState | null;
  captureSelectionPixels: (rect: SelectionRect, source?: PixelValue[]) => SelectionPixel[];
  resolvePointerFromClientPoint: (
    clientX: number,
    clientY: number,
    options?: { clamp?: boolean },
  ) => ResolvedMovePointer | null;
  saveStacks: () => HistoryStacks;
  restoreStacks: (stacks: HistoryStacks) => void;
  beginActionWithSnapshot: (snapshot: LayerSnapshot) => void;
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

/**
 * The move tool's drag: translating a layer (and any selection on it) with
 * the pointer. It records the pre-drag snapshot into history only once the
 * pointer has moved, and rolls the stacks back when the drag is cancelled or
 * ends where it started. While the move tool is active it also listens on
 * the window so a drag completes outside the canvas.
 */
export function useMoveDrag({
  gridWidth,
  gridHeight,
  totalCells,
  tool,
  autoPickLayer,
  gridRef,
  layersRef,
  setLayers,
  activeLayerId,
  setActiveLayerId,
  setActiveLayerPixelsState,
  selectionRef,
  setSelection,
  captureSelectionPixels,
  resolvePointerFromClientPoint,
  saveStacks,
  restoreStacks,
  beginActionWithSnapshot,
  finalizeAction,
}: MoveDragOptions): MoveDragApi {
  const moveDragRef = useRef<MoveDrag | null>(null);

  const coordsToIndex = useCallback(
    (x: number, y: number) => y * gridWidth + x,
    [gridWidth],
  );

  const isInBounds = useCallback(
    (x: number, y: number) => x >= 0 && x < gridWidth && y >= 0 && y < gridHeight,
    [gridHeight, gridWidth],
  );

  const setMoveLayerPixels = useCallback((layerId: string, pixels: PixelValue[]) => {
    const index = layersRef.current.findIndex((layer) => layer.id === layerId);
    if (index < 0) return;
    const nextLayers = [...layersRef.current];
    nextLayers[index] = { ...nextLayers[index], pixels };
    setLayers(nextLayers);
    setActiveLayerPixelsState(pixels);
  }, [layersRef, setActiveLayerPixelsState, setLayers]);

  const hasActiveDrag = useCallback(() => moveDragRef.current !== null, []);

  const beginMoveDrag = useCallback(
    (canvas: HTMLCanvasElement, pointerId: number, resolved: ResolvedMovePointer) => {
      const currentSelection = cloneSelection(selectionRef.current);
      let targetLayer = layersRef.current.find((layer) => layer.id === activeLayerId);
      if (autoPickLayer && !currentSelection) {
        for (let layerIndex = layersRef.current.length - 1; layerIndex >= 0; layerIndex -= 1) {
          const candidate = layersRef.current[layerIndex];
          const pixel = candidate.pixels[resolved.index];
          if (candidate.visible && pixel !== null && pixel !== "transparent") {
            targetLayer = candidate;
            break;
          }
        }
      }
      if (!targetLayer) return;
      const sourcePixels = targetLayer.pixels.slice();
      const movePixels = sourcePixels.slice();
      if (currentSelection?.isFloating) {
        for (const pixel of currentSelection.pixels) {
          const x = currentSelection.rect.x + currentSelection.offset.dx + pixel.relX;
          const y = currentSelection.rect.y + currentSelection.offset.dy + pixel.relY;
          if (isInBounds(x, y)) movePixels[coordsToIndex(x, y)] = pixel.color;
        }
      }
      if (targetLayer.id !== activeLayerId) {
        setActiveLayerId(targetLayer.id);
        setActiveLayerPixelsState(targetLayer.pixels);
      }
      moveDragRef.current = {
        pointerId,
        layerId: targetLayer.id,
        originalActiveLayerId: activeLayerId,
        origin: { x: resolved.cellX, y: resolved.cellY },
        delta: { dx: 0, dy: 0 },
        sourcePixels,
        movePixels,
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
    [
      activeLayerId,
      autoPickLayer,
      coordsToIndex,
      isInBounds,
      layersRef,
      saveStacks,
      selectionRef,
      setActiveLayerId,
      setActiveLayerPixelsState,
    ],
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
      beginActionWithSnapshot({
        layers: cloneLayers(layersRef.current, totalCells),
        activeLayerId: drag.layerId,
        selection: cloneSelection(drag.sourceSelection),
      });
      drag.actionStarted = true;
    }
    drag.delta = { dx, dy };
    const nextPixels = dx === 0 && dy === 0
      ? drag.sourcePixels.slice()
      : translatePixels(drag.movePixels, gridWidth, gridHeight, dx, dy);
    setMoveLayerPixels(drag.layerId, nextPixels);

    let nextSelection: SelectionState | null = null;
    if (drag.sourceSelection) {
      if (dx === 0 && dy === 0) {
        nextSelection = cloneSelection(drag.sourceSelection);
      } else {
        const sourceRect = drag.sourceSelection.rect;
        const shiftedX = sourceRect.x + drag.sourceSelection.offset.dx + dx;
        const shiftedY = sourceRect.y + drag.sourceSelection.offset.dy + dy;
        const left = Math.max(0, shiftedX);
        const top = Math.max(0, shiftedY);
        const right = Math.min(gridWidth, shiftedX + sourceRect.width);
        const bottom = Math.min(gridHeight, shiftedY + sourceRect.height);
        if (right > left && bottom > top) {
          const rect = { x: left, y: top, width: right - left, height: bottom - top };
          nextSelection = {
            rect,
            offset: { dx: 0, dy: 0 },
            pixels: captureSelectionPixels(rect, nextPixels),
            isFloating: false,
          };
        }
      }
    }
    setSelection(nextSelection);
  }, [beginActionWithSnapshot, captureSelectionPixels, gridHeight, gridWidth, layersRef, resolvePointerFromClientPoint, setMoveLayerPixels, setSelection, totalCells]);

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
    const currentLayer = layersRef.current.find((layer) => layer.id === drag.layerId);
    const changed = drag.actionStarted && !!currentLayer && (
      !arePixelsEqual(currentLayer.pixels, drag.sourcePixels) ||
      !areSelectionsEqual(selectionRef.current, drag.sourceSelection)
    );
    if (cancelled || !changed) {
      if (drag.actionStarted) {
        setMoveLayerPixels(drag.layerId, drag.sourcePixels.slice());
        const restoredSelection = cloneSelection(drag.sourceSelection);
        setSelection(restoredSelection);
        restoreStacks(drag.previousHistory);
      }
      if (cancelled && drag.originalActiveLayerId !== drag.layerId) {
        const originalLayer = layersRef.current.find((layer) => layer.id === drag.originalActiveLayerId);
        if (originalLayer) {
          setActiveLayerId(originalLayer.id);
          setActiveLayerPixelsState(originalLayer.pixels);
        }
      }
    } else {
      finalizeAction();
    }
    return true;
  }, [finalizeAction, gridRef, layersRef, restoreStacks, selectionRef, setActiveLayerId, setActiveLayerPixelsState, setMoveLayerPixels, setSelection]);

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
