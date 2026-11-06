/**
 * Benchmark scenarios for the pixel hot paths. Pure and React-free: they exercise only
 * `pixel-buffer.ts` and `grid-geometry.ts` so `npm run bench` measures the model, not the DOM.
 */
import {
  clearScratchMask,
  collectFillMask,
  computeBrushIndices,
  stampScratch,
  traceWorldSegment,
  type GridPoint,
  type GridSize,
  type ScratchMask,
} from "./grid-geometry";
import {
  composeInto,
  copyShiftedRect,
  createBuffer,
  extractRect,
  fillMask,
  intersectRect,
  nonEmptyBounds,
  toPackedValue,
  unionRect,
  writeRect,
  type DirtyRect,
  type PixelBuffer,
} from "./pixel-buffer";
import { HISTORY_TILE_SIZE } from "./PixelPencil.constants";

type StrokePatch = { tiles: { rect: DirtyRect; before: Uint32Array; after: Uint32Array }[] };

export type Scenario = {
  size: number;
  grid: GridSize;
  /** Painted layers (every third cell set), bottom first. */
  layers: PixelBuffer[];
  composite: PixelBuffer;
  /** Destination for translate steps. */
  shifted: PixelBuffer;
  /** Always-empty canvas the bucket fill reads from. */
  empty: PixelBuffer;
  /** Canvas the bucket fill writes into. */
  fillTarget: PixelBuffer;
  scratch: ScratchMask | null;
  /** Union of the layers' painted bounds, cached like a move drag caches it at pointer-down. */
  moveBounds: DirtyRect | null;
  patch: StrokePatch | null;
  /** Alternates the paint value so repeated runs keep changing cells. */
  runs: number;
};

const STROKE_COLORS = [toPackedValue("#e11d48"), toPackedValue("#2563eb")];

export function createScenario(size: number, layerCount = 3): Scenario {
  const layers: PixelBuffer[] = [];
  for (let l = 0; l < layerCount; l += 1) {
    const layer = createBuffer(size, size);
    const color = toPackedValue(["#16a34a", "#f59e0b", "#7c3aed", "#0ea5e9"][l % 4]);
    for (let i = l % 3; i < layer.data.length; i += 3) layer.data[i] = color;
    layers.push(layer);
  }
  const composite = createBuffer(size, size);
  composeInto(composite, layers.map((pixels) => ({ visible: true, pixels })), null);
  return {
    size,
    grid: { width: size, height: size },
    layers,
    composite,
    shifted: createBuffer(size, size),
    empty: createBuffer(size, size),
    fillTarget: createBuffer(size, size),
    scratch: null,
    moveBounds: null,
    patch: null,
    runs: 0,
  };
}

/**
 * Traces the diagonal from 30% to 70% of the canvas in `steps` pointer moves, stamping each
 * step's brush footprint into the stroke mask incrementally. Returns the stamped bounds, whose
 * area is bounded by the stroke, not the canvas.
 */
function buildStrokeMask(scenario: Scenario, steps: number, brushSize: number): DirtyRect | null {
  const { grid, size } = scenario;
  scenario.scratch = clearScratchMask(scenario.scratch, grid);
  const scratch = scenario.scratch;
  const start = size * 0.3;
  const span = size * 0.4;
  let previous: GridPoint = { x: start, y: start };
  for (let step = 1; step <= steps; step += 1) {
    const next = { x: start + (span * step) / steps, y: start + (span * step) / steps };
    for (const cell of traceWorldSegment(grid, previous, next)) {
      stampScratch(scratch, grid, computeBrushIndices(grid, cell, brushSize, "circle"));
    }
    previous = next;
  }
  return scratch.bounds;
}

/** A freehand stroke with incremental preview stamping and one `fillMask` commit; returns the edit rect. */
export function runStroke(scenario: Scenario, steps = 200, brushSize = 16): DirtyRect | null {
  const bounds = buildStrokeMask(scenario, steps, brushSize);
  if (!bounds || !scenario.scratch) return null;
  const value = STROKE_COLORS[scenario.runs % STROKE_COLORS.length];
  scenario.runs += 1;
  return fillMask(scenario.layers[0], scenario.scratch.mask, bounds, value);
}

/** Bucket fill of an empty canvas: scanline mask collection plus the commit. Returns the edit rect. */
export function runBucketFillEmpty(scenario: Scenario): DirtyRect | null {
  const region = collectFillMask(scenario.empty, 0);
  if (!region) return null;
  const value = STROKE_COLORS[scenario.runs % STROKE_COLORS.length];
  scenario.runs += 1;
  return fillMask(scenario.fillTarget, region.mask, region.bounds, value);
}

/** One move-drag step: every layer's painted bounds shifted by (dx, dy). Returns the rect written. */
export function runTranslateStep(scenario: Scenario, dx = 100, dy = 0): DirtyRect | null {
  if (!scenario.moveBounds) {
    let bounds: DirtyRect | null = null;
    for (const layer of scenario.layers) bounds = unionRect(bounds, nonEmptyBounds(layer));
    scenario.moveBounds = bounds;
  }
  const bounds = scenario.moveBounds;
  if (!bounds) return null;
  for (const layer of scenario.layers) copyShiftedRect(layer, scenario.shifted, bounds, dx, dy);
  return intersectRect(bounds, { x: 0, y: 0, width: scenario.size, height: scenario.size });
}

/** Recomposes a 64x64 dirty rectangle in the middle of the canvas. */
export function runRecompose64(scenario: Scenario): DirtyRect {
  const offset = Math.max(0, Math.floor((scenario.size - 64) / 2));
  const rect = { x: offset, y: offset, width: Math.min(64, scenario.size), height: Math.min(64, scenario.size) };
  composeInto(scenario.composite, scenario.layers.map((pixels) => ({ visible: true, pixels })), rect);
  return rect;
}

const tilesIn = (rect: DirtyRect, size: number): DirtyRect[] => {
  const tiles: DirtyRect[] = [];
  const firstX = Math.floor(rect.x / HISTORY_TILE_SIZE);
  const lastX = Math.floor((rect.x + rect.width - 1) / HISTORY_TILE_SIZE);
  const firstY = Math.floor(rect.y / HISTORY_TILE_SIZE);
  const lastY = Math.floor((rect.y + rect.height - 1) / HISTORY_TILE_SIZE);
  for (let ty = firstY; ty <= lastY; ty += 1) {
    for (let tx = firstX; tx <= lastX; tx += 1) {
      const x = tx * HISTORY_TILE_SIZE;
      const y = ty * HISTORY_TILE_SIZE;
      tiles.push({
        x,
        y,
        width: Math.min(HISTORY_TILE_SIZE, size - x),
        height: Math.min(HISTORY_TILE_SIZE, size - y),
      });
    }
  }
  return tiles;
};

/** Builds (once) the stroke's before/after tile patch, leaving layer 0 in the "after" state. */
function prepareStrokePatch(scenario: Scenario): StrokePatch {
  const bounds = buildStrokeMask(scenario, 200, 16);
  const layer = scenario.layers[0];
  const tiles: StrokePatch["tiles"] = [];
  if (bounds && scenario.scratch) {
    const rects = tilesIn(bounds, scenario.size);
    const befores = rects.map((rect) => extractRect(layer, rect));
    fillMask(layer, scenario.scratch.mask, bounds, STROKE_COLORS[0]);
    rects.forEach((rect, i) => tiles.push({ rect, before: befores[i], after: extractRect(layer, rect) }));
  }
  return { tiles };
}

/**
 * Undo then redo of the stroke's tile patch (64x64 tiles), the way the history hook replays it.
 * Returns the bytes written in both directions; layer 0 ends in the stroked state.
 */
export function runUndoRedo(scenario: Scenario): number {
  scenario.patch ??= prepareStrokePatch(scenario);
  const layer = scenario.layers[0];
  let bytes = 0;
  for (const tile of scenario.patch.tiles) {
    writeRect(layer, tile.rect, tile.before);
    bytes += tile.before.byteLength;
  }
  for (const tile of scenario.patch.tiles) {
    writeRect(layer, tile.rect, tile.after);
    bytes += tile.after.byteLength;
  }
  return bytes;
}
