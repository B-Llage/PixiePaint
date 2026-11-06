import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  brushBounds,
  clearMaskRect,
  clearScratchMask,
  computeBrushIndices as computeBrushIndicesOnGrid,
  createMask,
  stampCells,
  stampScratch,
  traceWorldSegment as traceWorldSegmentOnGrid,
  type PreviewMask,
  type ScratchMask,
} from "../grid-geometry";
import type { EditLayer } from "../layer-edit";
import { fillCells, fillMask, toPackedValue, type DirtyRect } from "../pixel-buffer";
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
  /** The layer every brush edit writes to. */
  activeLayerId: string;
  /** Writes to a layer through the editor, which records history and recomposites. */
  editLayer: EditLayer;
  /** Shows (or with `null` hides) the path preview; the mask may be reused by later builds. */
  setPathPreview: (next: PreviewMask | null) => void;
  setDragStartIndex: Dispatch<SetStateAction<number | null>>;
  setDrawValue: (value: PixelValue) => void;
  setHoverIndexIfChanged: (next: number | null) => void;
  /** Converts a client point to the cell index and fractional artwork point under it. */
  resolvePointerFromClientPoint: (
    clientX: number,
    clientY: number,
    options?: { clamp?: boolean },
  ) => StrokePointer | null;
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
  /** Paints the brush footprint at a cell through one `editLayer` call bounded by the brush square. */
  applyBrush: (index: number, value: PixelValue) => void;
  /** Paints the brush footprint along a path in one `editLayer` call bounded by the stamped cells. */
  applyLinePath: (path: number[], value: PixelValue) => void;
  /**
   * The preview mask for a path drawn with the current brush. The mask is a
   * scratch reused (and cleared over its previous bounds) by the next build.
   */
  buildLinePreview: (path: number[]) => PreviewMask;
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
  activeLayerId,
  editLayer,
  setPathPreview,
  setDragStartIndex,
  setDrawValue,
  setHoverIndexIfChanged,
  resolvePointerFromClientPoint,
  finalizeAction,
}: StrokePipelineOptions): StrokePipelineApi {
  const isDrawingRef = useRef(false);
  const lastPaintedIndexRef = useRef<number | null>(null);
  const strokeWorldPointsRef = useRef<WorldPoint[] | null>(null);
  const strokeAppliedCellsRef = useRef<Set<number> | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerQueueRef = useRef<WorldPoint[]>([]);
  const pointerRAFRef = useRef<number | null>(null);
  /** Canvas-sized scratch mask for path and stroke commits; cleared over its bounds after each use. */
  const scratchMaskRef = useRef<Uint8Array | null>(null);
  /** Separate scratch mask for the path preview, which stays visible between commits. */
  const previewMaskRef = useRef<ScratchMask | null>(null);
  /** The freehand stroke's mask: grown by new cells while drawing, committed as one edit, then cleared. */
  const strokeMaskRef = useRef<ScratchMask | null>(null);
  /** The stroke mask as handed to `setPathPreview`; its bounds grow in place with the mask. */
  const strokePreviewRef = useRef<PreviewMask | null>(null);

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
      const grid = { width: gridWidth, height: gridHeight };
      const rect = brushBounds(grid, index, brushSize);
      const packed = toPackedValue(value);
      editLayer(activeLayerId, rect, (buffer) => fillCells(buffer, computeBrushIndices(index), packed));
    },
    [activeLayerId, brushSize, computeBrushIndices, editLayer, gridHeight, gridWidth],
  );

  /** Stamps the brush footprint of every cell into the scratch mask and fills it in one edit. */
  const fillFootprints = useCallback(
    (cells: Iterable<number>, value: PixelValue) => {
      const grid = { width: gridWidth, height: gridHeight };
      let mask = scratchMaskRef.current;
      if (!mask || mask.length !== gridWidth * gridHeight) {
        mask = createMask(grid);
        scratchMaskRef.current = mask;
      }
      let bounds: DirtyRect | null = null;
      for (const cell of cells) {
        bounds = stampCells(mask, grid, computeBrushIndices(cell), bounds);
      }
      if (!bounds) return;
      const stamped = bounds;
      const packed = toPackedValue(value);
      try {
        editLayer(activeLayerId, stamped, (buffer) => fillMask(buffer, mask, stamped, packed));
      } finally {
        clearMaskRect(mask, grid, stamped);
      }
    },
    [activeLayerId, computeBrushIndices, editLayer, gridHeight, gridWidth],
  );

  const applyLinePath = useCallback(
    (path: number[], value: PixelValue) => fillFootprints(path, value),
    [fillFootprints],
  );

  /** Stamps every cell's brush footprint into the preview scratch mask, cleared over its last stamp first. */
  const buildFootprintPreview = useCallback(
    (cells: Iterable<number>): PreviewMask => {
      const grid = { width: gridWidth, height: gridHeight };
      const scratch = clearScratchMask(previewMaskRef.current, grid);
      previewMaskRef.current = scratch;
      for (const cell of cells) {
        stampScratch(scratch, grid, computeBrushIndices(cell));
      }
      return { mask: scratch.mask, bounds: scratch.bounds ?? { x: 0, y: 0, width: 0, height: 0 } };
    },
    [computeBrushIndices, gridHeight, gridWidth],
  );

  const buildLinePreview = useCallback(
    (path: number[]) => buildFootprintPreview(path),
    [buildFootprintPreview],
  );

  const traceWorldSegment = useCallback(
    (from: WorldPoint, to: WorldPoint) =>
      traceWorldSegmentOnGrid({ width: gridWidth, height: gridHeight }, from, to),
    [gridHeight, gridWidth],
  );

  /** Clears the stroke mask over its bounds, or lays out a fresh one when the grid size changed. */
  const resetStrokeMask = useCallback(() => {
    strokeMaskRef.current = clearScratchMask(strokeMaskRef.current, {
      width: gridWidth,
      height: gridHeight,
    });
    strokePreviewRef.current = null;
  }, [gridHeight, gridWidth]);

  /** Stamps brush footprints into the stroke mask and, with previews on, publishes the grown mask. */
  const stampStrokeCells = useCallback(
    (cells: number[]) => {
      const scratch = strokeMaskRef.current;
      if (!scratch) return;
      const grid = { width: gridWidth, height: gridHeight };
      for (const cell of cells) {
        stampScratch(scratch, grid, computeBrushIndices(cell));
      }
      if (!previewToolEffects || !scratch.bounds) return;
      const preview = strokePreviewRef.current ?? { mask: scratch.mask, bounds: scratch.bounds };
      preview.bounds = scratch.bounds;
      strokePreviewRef.current = preview;
      setPathPreview(preview);
    },
    [computeBrushIndices, gridHeight, gridWidth, previewToolEffects, setPathPreview],
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
        strokeAppliedCellsRef.current = new Set([pointer.index]);
        resetStrokeMask();
        setPathPreview(null);
        stampStrokeCells([pointer.index]);
      } else {
        strokeWorldPointsRef.current = null;
        strokeAppliedCellsRef.current = null;
      }

      startStroke(pointer, value);
    },
    [resetStrokeMask, setPathPreview, stampStrokeCells, startStroke],
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
        const newCells: number[] = [];
        for (const cell of traceWorldSegment(lastPoint, worldPoint)) {
          if (applied.has(cell)) continue;
          applied.add(cell);
          newCells.push(cell);
        }
        if (newCells.length) stampStrokeCells(newCells);
      }
    },
    [stampStrokeCells, traceWorldSegment],
  );

  const commitStrokeBuffer = useCallback(
    (value: PixelValue) => {
      const scratch = strokeMaskRef.current;
      const bounds = scratch?.bounds;
      if (!scratch || !bounds) return;
      const grid = { width: gridWidth, height: gridHeight };
      const packed = toPackedValue(value);
      try {
        editLayer(activeLayerId, bounds, (buffer) => fillMask(buffer, scratch.mask, bounds, packed));
      } finally {
        clearMaskRect(scratch.mask, grid, bounds);
        scratch.bounds = null;
      }
    },
    [activeLayerId, editLayer, gridHeight, gridWidth],
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
    if (strokeMaskRef.current) {
      strokeMaskRef.current = clearScratchMask(strokeMaskRef.current, {
        width: gridWidth,
        height: gridHeight,
      });
    }
    strokePreviewRef.current = null;
    activePointerIdRef.current = null;
    setDragStartIndex(null);
    setPathPreview(null);
    clearPointerQueue();
    finalizeAction();
  }, [clearPointerQueue, finalizeAction, gridHeight, gridWidth, setDragStartIndex, setPathPreview]);

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
