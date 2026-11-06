import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  computeBrushIndices as computeBrushIndicesOnGrid,
  traceWorldSegment as traceWorldSegmentOnGrid,
} from "../grid-geometry";
import type { ToolId } from "../PixelPencilTools";
import type { BrushShape, PixelValue } from "../PixelPencilTypes";

type WorldPoint = { x: number; y: number };

/** The cell a stroke starts on and the fractional artwork point under the pointer. */
export type StrokePointer = { index: number; position: WorldPoint };

export type StrokePipelineOptions = {
  gridWidth: number;
  gridHeight: number;
  tool: ToolId;
  brushSize: number;
  brushShape: BrushShape;
  previewToolEffects: boolean;
  activeLayerPixelsRef: RefObject<PixelValue[]>;
  setActiveLayerPixels: (next: SetStateAction<PixelValue[]>) => void;
  setPathPreview: Dispatch<SetStateAction<Set<number> | null>>;
  setDragStartIndex: Dispatch<SetStateAction<number | null>>;
  setDrawValue: (value: PixelValue) => void;
  setHoverIndexIfChanged: (next: number | null) => void;
  /** Converts a client point to the cell index and fractional artwork point under it. */
  resolvePointerFromClientPoint: (
    clientX: number,
    clientY: number,
    options?: { clamp?: boolean },
  ) => StrokePointer | null;
  markModified: () => void;
  finalizeAction: () => void;
};

export type StrokePipelineApi = {
  /** True from the first brush application until `stopStroke`. */
  isDrawingRef: RefObject<boolean>;
  /** The pointer captured for the stroke; other pointers' moves are ignored. */
  activePointerIdRef: RefObject<number | null>;
  /** The last cell painted by a single press, used by the shift-click line. */
  lastPaintedIndexRef: RefObject<number | null>;
  /** The brush footprint around a cell for the current size and shape. */
  computeBrushIndices: (centerIndex: number) => number[];
  /** Paints the brush footprint at a cell and marks the action modified if anything changed. */
  applyBrush: (index: number, value: PixelValue) => void;
  /** Paints the brush footprint along a path in one update. */
  applyLinePath: (path: number[], value: PixelValue) => void;
  /** The preview cells for a path drawn with the current brush. */
  buildLinePreview: (path: number[]) => Set<number>;
  /** Captures the pointer on the canvas and remembers it for the stroke, even if capture fails. */
  capturePointer: (canvas: HTMLCanvasElement, pointerId: number) => void;
  /** Line and shape tools: arms drawing without painting, so pointer-up applies the path. */
  beginDragStroke: (value: PixelValue) => void;
  /** Records the cell a shift-click line ended on, so the next shift-click continues from it. */
  markLastPainted: (index: number | null) => void;
  /** Clears the drawing flags without touching pixels or previews, when the tool changes. */
  resetDrawingState: () => void;
  /**
   * Pencil and eraser: paints the first cell and, for a freehand stroke, starts
   * collecting the cells the pointer crosses for the preview and the final commit.
   */
  beginStroke: (pointer: StrokePointer, value: PixelValue, freehand: boolean) => void;
  /** Adds a pointer sample to the freehand stroke, tracing the cells since the last sample. */
  appendStrokePoint: (worldPoint: WorldPoint) => void;
  /** Paints every cell the freehand stroke crossed with the brush. */
  commitStrokeBuffer: (value: PixelValue) => void;
  /** Ends the stroke, drops queued samples and previews, and finalizes the history action. */
  stopStroke: () => void;
  /** Drops queued pointer samples without processing them. */
  clearPointerQueue: () => void;
  /** Processes queued pointer samples now instead of on the next animation frame. */
  flushPointerQueue: () => void;
  /** Queues coalesced pointer samples to be traced on the next animation frame. */
  processDrawingSamples: (samples: PointerEvent[]) => void;
};

/**
 * The freehand drawing pipeline for the pencil and eraser, plus the brush
 * helpers the line and shape tools share with it.
 *
 * Pointer samples are queued and traced once per animation frame. The cells a
 * stroke crosses are collected as it goes and drawn as a preview; the layer is
 * painted in one update when the stroke ends. While a stroke is in progress
 * the pipeline also listens for pointer moves on the window so it keeps
 * tracing when the pointer leaves the canvas.
 */
export function useStrokePipeline({
  gridWidth,
  gridHeight,
  tool,
  brushSize,
  brushShape,
  previewToolEffects,
  activeLayerPixelsRef,
  setActiveLayerPixels,
  setPathPreview,
  setDragStartIndex,
  setDrawValue,
  setHoverIndexIfChanged,
  resolvePointerFromClientPoint,
  markModified,
  finalizeAction,
}: StrokePipelineOptions): StrokePipelineApi {
  const isDrawingRef = useRef(false);
  const lastPaintedIndexRef = useRef<number | null>(null);
  const strokeWorldPointsRef = useRef<WorldPoint[] | null>(null);
  const strokeAppliedCellsRef = useRef<Set<number> | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerQueueRef = useRef<WorldPoint[]>([]);
  const pointerRAFRef = useRef<number | null>(null);

  useEffect(() => {
    const pointerQueue = pointerQueueRef.current;
    return () => {
      pointerQueue.length = 0;
      if (pointerRAFRef.current !== null) {
        window.cancelAnimationFrame(pointerRAFRef.current);
        pointerRAFRef.current = null;
      }
    };
  }, []);

  const computeBrushIndices = useCallback(
    (centerIndex: number) =>
      computeBrushIndicesOnGrid({ width: gridWidth, height: gridHeight }, centerIndex, brushSize, brushShape),
    [brushShape, brushSize, gridHeight, gridWidth],
  );

  const applyBrush = useCallback(
    (index: number, value: PixelValue) => {
      const indices = computeBrushIndices(index);
      if (indices.length === 0) return;

      let changed = false;
      setActiveLayerPixels((prev) => {
        const next = [...prev];

        for (const target of indices) {
          if (next[target] === value) continue;
          next[target] = value;
          changed = true;
        }

        if (!changed) {
          return prev;
        }

        return next;
      });

      if (changed) {
        markModified();
      }
    },
    [computeBrushIndices, markModified, setActiveLayerPixels],
  );

  const applyLinePath = useCallback(
    (path: number[], value: PixelValue) => {
      if (!path.length) return;
      const current = activeLayerPixelsRef.current;
      const next = [...current];
      let changed = false;

      for (const pathIndex of path) {
        const indices = computeBrushIndices(pathIndex);
        for (const target of indices) {
          if (next[target] === value) continue;
          next[target] = value;
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      markModified();
      setActiveLayerPixels(next);
    },
    [activeLayerPixelsRef, computeBrushIndices, markModified, setActiveLayerPixels],
  );

  const buildLinePreview = useCallback(
    (path: number[]) => {
      const preview = new Set<number>();
      for (const index of path) {
        const indices = computeBrushIndices(index);
        for (const target of indices) {
          preview.add(target);
        }
      }
      return preview;
    },
    [computeBrushIndices],
  );

  const traceWorldSegment = useCallback(
    (from: WorldPoint, to: WorldPoint) =>
      traceWorldSegmentOnGrid({ width: gridWidth, height: gridHeight }, from, to),
    [gridHeight, gridWidth],
  );

  const buildPreviewFromAppliedCells = useCallback(
    (cells: Iterable<number>) => {
      const preview = new Set<number>();
      for (const cell of cells) {
        const footprint = computeBrushIndices(cell);
        for (const idx of footprint) {
          preview.add(idx);
        }
      }
      return preview;
    },
    [computeBrushIndices],
  );

  const capturePointer = useCallback((canvas: HTMLCanvasElement, pointerId: number) => {
    try {
      canvas.setPointerCapture(pointerId);
      activePointerIdRef.current = pointerId;
    } catch {
      activePointerIdRef.current = pointerId;
    }
  }, []);

  const beginDragStroke = useCallback(
    (value: PixelValue) => {
      isDrawingRef.current = true;
      setDrawValue(value);
      lastPaintedIndexRef.current = null;
    },
    [setDrawValue],
  );

  const markLastPainted = useCallback((index: number | null) => {
    lastPaintedIndexRef.current = index;
  }, []);

  const resetDrawingState = useCallback(() => {
    activePointerIdRef.current = null;
    isDrawingRef.current = false;
    lastPaintedIndexRef.current = null;
  }, []);

  const startStroke = useCallback(
    (pointer: StrokePointer, nextValue: PixelValue) => {
      isDrawingRef.current = true;
      setDrawValue(nextValue);
      lastPaintedIndexRef.current = pointer.index;
      applyBrush(pointer.index, nextValue);
    },
    [applyBrush, setDrawValue],
  );

  const beginStroke = useCallback(
    (pointer: StrokePointer, value: PixelValue, freehand: boolean) => {
      if (freehand) {
        strokeWorldPointsRef.current = [pointer.position];
        const applied = new Set<number>();
        applied.add(pointer.index);
        strokeAppliedCellsRef.current = applied;
        if (previewToolEffects) {
          setPathPreview(buildPreviewFromAppliedCells(applied));
        } else {
          setPathPreview(null);
        }
      } else {
        strokeWorldPointsRef.current = null;
        strokeAppliedCellsRef.current = null;
      }

      startStroke(pointer, value);
      if (strokeAppliedCellsRef.current && freehand) {
        strokeAppliedCellsRef.current.add(pointer.index);
        if (previewToolEffects) {
          setPathPreview(
            buildPreviewFromAppliedCells(strokeAppliedCellsRef.current),
          );
        }
      }
    },
    [buildPreviewFromAppliedCells, previewToolEffects, setPathPreview, startStroke],
  );

  const appendStrokePoint = useCallback(
    (worldPoint: WorldPoint) => {
      const worldPoints = strokeWorldPointsRef.current;
      const applied = strokeAppliedCellsRef.current;
      if (!worldPoints || !applied) return;
      const lastPoint = worldPoints[worldPoints.length - 1];
      if (
        lastPoint &&
        Math.hypot(lastPoint.x - worldPoint.x, lastPoint.y - worldPoint.y) < 0.01
      ) {
        return;
      }
      worldPoints.push(worldPoint);
      if (lastPoint) {
        const segmentCells = traceWorldSegment(lastPoint, worldPoint);
        if (segmentCells.length) {
          const newCells: number[] = [];
          for (const cell of segmentCells) {
            if (applied.has(cell)) continue;
            applied.add(cell);
            newCells.push(cell);
          }
          if (previewToolEffects) {
            setPathPreview(buildPreviewFromAppliedCells(applied));
          }
        }
      }
    },
    [buildPreviewFromAppliedCells, previewToolEffects, setPathPreview, traceWorldSegment],
  );

  const commitStrokeBuffer = useCallback(
    (value: PixelValue) => {
      const applied = strokeAppliedCellsRef.current;
      if (!applied || applied.size === 0) return;
      const targetCells = new Set<number>();
      for (const baseCell of applied) {
        const indices = computeBrushIndices(baseCell);
        for (const idx of indices) {
          targetCells.add(idx);
        }
      }
      if (!targetCells.size) return;
      setActiveLayerPixels((prev) => {
        const next = [...prev];
        let changed = false;
        targetCells.forEach((idx) => {
          if (next[idx] !== value) {
            next[idx] = value;
            changed = true;
          }
        });
        if (!changed) {
          return prev;
        }
        markModified();
        return next;
      });
    },
    [computeBrushIndices, markModified, setActiveLayerPixels],
  );

  const clearPointerQueue = useCallback(() => {
    pointerQueueRef.current.length = 0;
    if (pointerRAFRef.current !== null) {
      window.cancelAnimationFrame(pointerRAFRef.current);
      pointerRAFRef.current = null;
    }
  }, []);

  const stopStroke = useCallback(() => {
    isDrawingRef.current = false;
    lastPaintedIndexRef.current = null;
    strokeWorldPointsRef.current = null;
    strokeAppliedCellsRef.current = null;
    activePointerIdRef.current = null;
    setDragStartIndex(null);
    setPathPreview(null);
    clearPointerQueue();
    finalizeAction();
  }, [clearPointerQueue, finalizeAction, setDragStartIndex, setPathPreview]);

  const flushPointerQueue = useCallback(function flushPointerQueueInternal() {
    pointerRAFRef.current = null;
    if (!isDrawingRef.current) {
      pointerQueueRef.current.length = 0;
      return;
    }
    const pending = pointerQueueRef.current.splice(0, pointerQueueRef.current.length);
    let lastIndex: number | null = null;
    for (const point of pending) {
      const resolved = resolvePointerFromClientPoint(point.x, point.y, {
        clamp: true,
      });
      if (!resolved) continue;
      appendStrokePoint(resolved.position);
      lastIndex = resolved.index;
    }
    if (lastIndex !== null) {
      setHoverIndexIfChanged(lastIndex);
    }
    if (pointerQueueRef.current.length) {
      pointerRAFRef.current = window.requestAnimationFrame(
        flushPointerQueueInternal,
      );
    }
  }, [appendStrokePoint, resolvePointerFromClientPoint, setHoverIndexIfChanged]);

  const enqueuePointerPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (typeof window === "undefined") return;
      pointerQueueRef.current.push({ x: clientX, y: clientY });
      if (pointerRAFRef.current === null) {
        pointerRAFRef.current = window.requestAnimationFrame(flushPointerQueue);
      }
    },
    [flushPointerQueue],
  );

  const processDrawingSamples = useCallback(
    (samples: PointerEvent[]) => {
      for (const sample of samples) {
        enqueuePointerPosition(sample.clientX, sample.clientY);
      }
    },
    [enqueuePointerPosition],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleGlobalPointerMove = (event: PointerEvent) => {
      if (!isDrawingRef.current) return;
      if (tool === "line" || tool === "shape") {
        return;
      }
      if (
        activePointerIdRef.current !== null &&
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }
      const coalesced =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      const samples =
        coalesced.length > 0 ? [...coalesced, event] : [event];
      processDrawingSamples(samples);
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", handleGlobalPointerMove);
    };
  }, [processDrawingSamples, tool]);

  return {
    isDrawingRef,
    activePointerIdRef,
    lastPaintedIndexRef,
    computeBrushIndices,
    applyBrush,
    applyLinePath,
    buildLinePreview,
    capturePointer,
    beginDragStroke,
    markLastPainted,
    resetDrawingState,
    beginStroke,
    appendStrokePoint,
    commitStrokeBuffer,
    stopStroke,
    clearPointerQueue,
    flushPointerQueue,
    processDrawingSamples,
  };
}
