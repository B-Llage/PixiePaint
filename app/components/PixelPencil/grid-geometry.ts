import type { DirtyRect, PixelBuffer } from "./pixel-buffer";
import type { BrushShape, ShapeKind } from "./PixelPencilTypes";

/** Pure grid algorithms over a row-major `width * height` cell grid. */
export type GridSize = { width: number; height: number };
export type GridPoint = { x: number; y: number };

/** World-space distance between stroke samples, in cells. */
export const RESAMPLE_STEP = 0.5;
/** Upper bound on samples per stroke segment, guarding against runaway pointer jumps. */
export const MAX_SEGMENT_STEPS = 2048;

export const coordsToIndex = (grid: GridSize, x: number, y: number) => y * grid.width + x;

export const indexToCoords = (grid: GridSize, index: number): GridPoint => ({
  x: index % grid.width,
  y: Math.floor(index / grid.width),
});

export const isInBounds = (grid: GridSize, x: number, y: number) =>
  x >= 0 && x < grid.width && y >= 0 && y < grid.height;

/** Cells covered by a square or circular brush centered on `centerIndex`, clipped to the grid. */
export function computeBrushIndices(
  grid: GridSize,
  centerIndex: number,
  brushSize: number,
  brushShape: BrushShape,
): number[] {
  const { x: centerX, y: centerY } = indexToCoords(grid, centerIndex);
  const startOffset = -Math.floor((brushSize - 1) / 2);
  const endOffset = Math.ceil((brushSize - 1) / 2);
  const indices: number[] = [];

  const circleCenter = (startOffset + endOffset) / 2;
  const radiusSquared = (brushSize / 2) ** 2;

  const minY = Math.max(startOffset, -centerY);
  const maxY = Math.min(endOffset, grid.height - 1 - centerY);
  const minX = Math.max(startOffset, -centerX);
  const maxX = Math.min(endOffset, grid.width - 1 - centerX);

  for (let dy = minY; dy <= maxY; dy += 1) {
    for (let dx = minX; dx <= maxX; dx += 1) {
      if (
        brushShape === "circle" &&
        (dx - circleCenter) ** 2 + (dy - circleCenter) ** 2 > radiusSquared
      ) {
        continue;
      }
      indices.push(coordsToIndex(grid, centerX + dx, centerY + dy));
    }
  }

  return indices;
}

/** Bresenham line between two cell indices, inclusive, skipping cells outside the grid. */
export function computeLineIndices(grid: GridSize, startIndex: number, endIndex: number): number[] {
  if (startIndex === endIndex) {
    return [startIndex];
  }

  let { x: x0, y: y0 } = indexToCoords(grid, startIndex);
  const { x: x1, y: y1 } = indexToCoords(grid, endIndex);

  const result: number[] = [];

  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (isInBounds(grid, x0, y0)) {
      result.push(coordsToIndex(grid, x0, y0));
    }
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return result;
}

/**
 * Rasterizes a square, circle, or triangle within the bounding box of two cell indices.
 * The triangle's apex sits on the row the drag started from. Unfilled shapes keep only
 * the cells that touch the shape's outside or the grid edge.
 */
export function computeShapeCells(
  grid: GridSize,
  startIndex: number,
  endIndex: number,
  shape: ShapeKind,
  filled: boolean,
): number[] {
  const { x: startX, y: startY } = indexToCoords(grid, startIndex);
  const { x: endX, y: endY } = indexToCoords(grid, endIndex);

  const minX = Math.max(0, Math.min(startX, endX));
  const maxX = Math.min(grid.width - 1, Math.max(startX, endX));
  const minY = Math.max(0, Math.min(startY, endY));
  const maxY = Math.min(grid.height - 1, Math.max(startY, endY));
  const topToBottom = startY <= endY;

  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);

  const cells: number[] = [];

  const pushCell = (x: number, y: number) => {
    if (!isInBounds(grid, x, y)) return;
    cells.push(coordsToIndex(grid, x, y));
  };

  const addSquare = () => {
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        pushCell(x, y);
      }
    }
  };

  const addCircle = () => {
    const centerX = minX + (width - 1) / 2;
    const centerY = minY + (height - 1) / 2;
    const radius = Math.max(width, height) / 2;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radius * radius) {
          pushCell(x, y);
        }
      }
    }
  };

  const addTriangle = () => {
    const effectiveHeight = Math.max(height - 1, 1);
    const centerX = minX + (width - 1) / 2;
    if (topToBottom) {
      for (let y = minY; y <= maxY; y += 1) {
        const progress = (y - minY) / effectiveHeight;
        const halfSpan = (width - 1) / 2 * (1 - progress);
        const left = Math.round(centerX - halfSpan);
        const right = Math.round(centerX + halfSpan);
        for (let x = left; x <= right; x += 1) {
          pushCell(x, y);
        }
      }
    } else {
      for (let y = maxY; y >= minY; y -= 1) {
        const progress = (maxY - y) / effectiveHeight;
        const halfSpan = (width - 1) / 2 * (1 - progress);
        const left = Math.round(centerX - halfSpan);
        const right = Math.round(centerX + halfSpan);
        for (let x = left; x <= right; x += 1) {
          pushCell(x, y);
        }
      }
    }
  };

  if (shape === "square") {
    addSquare();
  } else if (shape === "circle") {
    addCircle();
  } else {
    addTriangle();
  }

  if (filled) {
    return cells;
  }

  const perimeter = new Set<number>();
  const cellSet = new Set(cells);
  const neighborOffsets = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  for (const cell of cells) {
    const { x, y } = indexToCoords(grid, cell);
    for (const { dx, dy } of neighborOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isInBounds(grid, nx, ny) || !cellSet.has(coordsToIndex(grid, nx, ny))) {
        perimeter.add(cell);
        break;
      }
    }
  }

  return Array.from(perimeter);
}

/**
 * Resamples a stroke segment between two world-space points (fractional cell coordinates)
 * every `RESAMPLE_STEP` cells and links consecutive samples with Bresenham lines so the
 * stroke has no gaps. Samples outside the grid are skipped. The returned cells begin at
 * the first in-bounds sample and never repeat consecutive cells.
 */
export function traceWorldSegment(grid: GridSize, from: GridPoint, to: GridPoint): number[] {
  const cells: number[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  let steps = distance / RESAMPLE_STEP;
  if (!Number.isFinite(steps)) {
    steps = 0;
  }
  steps = Math.min(MAX_SEGMENT_STEPS, Math.max(1, Math.ceil(steps)));
  let previousIndex: number | null = null;

  for (let step = 0; step <= steps; step += 1) {
    const t = steps === 0 ? 0 : step / steps;
    const sampleX = from.x + dx * t;
    const sampleY = from.y + dy * t;
    const cellX = Math.floor(sampleX);
    const cellY = Math.floor(sampleY);
    if (!isInBounds(grid, cellX, cellY)) continue;
    const currentIndex = coordsToIndex(grid, cellX, cellY);
    if (previousIndex === null) {
      cells.push(currentIndex);
      previousIndex = currentIndex;
      continue;
    }
    if (currentIndex === previousIndex) {
      continue;
    }
    const link = computeLineIndices(grid, previousIndex, currentIndex);
    for (let pos = 1; pos < link.length; pos += 1) {
      cells.push(link[pos]);
    }
    previousIndex = currentIndex;
  }

  return cells;
}

/** A canvas-sized, index-aligned cell mask (`1` = set) with the bounding rect of its set cells. */
export type PreviewMask = { mask: Uint8Array; bounds: DirtyRect };

export const createMask = (grid: GridSize): Uint8Array => new Uint8Array(grid.width * grid.height);

/** Sets the listed cells in `mask`; returns the union of `bounds` and the stamped cells' rect. */
export function stampCells(
  mask: Uint8Array,
  grid: GridSize,
  indices: ArrayLike<number>,
  bounds: DirtyRect | null,
): DirtyRect | null {
  if (indices.length === 0) return bounds;
  const { width } = grid;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i];
    mask[index] = 1;
    const y = Math.floor(index / width);
    const x = index - y * width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const stamped = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  if (!bounds) return stamped;
  const left = Math.min(bounds.x, stamped.x);
  const top = Math.min(bounds.y, stamped.y);
  const right = Math.max(bounds.x + bounds.width, stamped.x + stamped.width);
  const bottom = Math.max(bounds.y + bounds.height, stamped.y + stamped.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Clears every mask cell inside `rect` (clipped to the grid). */
export function clearMaskRect(mask: Uint8Array, grid: GridSize, rect: DirtyRect): void {
  const minX = Math.max(0, rect.x);
  const maxX = Math.min(grid.width, rect.x + rect.width);
  const minY = Math.max(0, rect.y);
  const maxY = Math.min(grid.height, rect.y + rect.height);
  if (maxX <= minX) return;
  for (let y = minY; y < maxY; y += 1) {
    mask.fill(0, y * grid.width + minX, y * grid.width + maxX);
  }
}

/** A reusable canvas-sized mask that remembers the bounds of what was stamped into it. */
export type ScratchMask = { mask: Uint8Array; width: number; bounds: DirtyRect | null };

/**
 * Returns a clear scratch mask for `grid`: `scratch` cleared over its stamped
 * bounds when it was laid out for the same grid, otherwise a new mask. Clearing
 * costs the previous stamp's bounds, never the whole canvas.
 */
export function clearScratchMask(scratch: ScratchMask | null, grid: GridSize): ScratchMask {
  if (!scratch || scratch.width !== grid.width || scratch.mask.length !== grid.width * grid.height) {
    return { mask: createMask(grid), width: grid.width, bounds: null };
  }
  if (scratch.bounds) clearMaskRect(scratch.mask, grid, scratch.bounds);
  scratch.bounds = null;
  return scratch;
}

/** Stamps the cells into the scratch mask and extends its bounds. */
export function stampScratch(scratch: ScratchMask, grid: GridSize, indices: ArrayLike<number>): void {
  scratch.bounds = stampCells(scratch.mask, grid, indices, scratch.bounds);
}

/** The scratch mask as a preview, or `null` when nothing is stamped. */
export const scratchPreview = (scratch: ScratchMask): PreviewMask | null =>
  scratch.bounds ? { mask: scratch.mask, bounds: scratch.bounds } : null;

/** The grid-clipped square a brush of `brushSize` covers around `centerIndex`, whatever its shape. */
export function brushBounds(grid: GridSize, centerIndex: number, brushSize: number): DirtyRect {
  const { x: centerX, y: centerY } = indexToCoords(grid, centerIndex);
  const startOffset = -Math.floor((brushSize - 1) / 2);
  const endOffset = Math.ceil((brushSize - 1) / 2);
  const minX = Math.max(0, centerX + startOffset);
  const maxX = Math.min(grid.width - 1, centerX + endOffset);
  const minY = Math.max(0, centerY + startOffset);
  const maxY = Math.min(grid.height - 1, centerY + endOffset);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Four-connected scanline fill over cells whose packed value equals the start cell's.
 * Uses a flat span stack and the mask as the visited set, so it allocates no per-cell objects.
 */
export function collectFillMask(buffer: PixelBuffer, startIndex: number): PreviewMask | null {
  const { width, height, data } = buffer;
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= width * height) return null;

  const target = data[startIndex];
  const mask = new Uint8Array(width * height);
  // Each span is four ints: y, xLeft, xRight (inclusive), and the row delta it was reached from.
  const stack: number[] = [];
  let minX = width;
  let maxX = -1;
  let minY = height;
  let maxY = -1;

  const startY = Math.floor(startIndex / width);
  const startX = startIndex - startY * width;
  stack.push(startY, startX, startX, 1, startY, startX, startX, -1);

  while (stack.length) {
    const dy = stack.pop()!;
    const xRight = stack.pop()!;
    const xLeft = stack.pop()!;
    const y = stack.pop()!;
    const row = y * width;

    // Extend the span left and right across matching, unvisited cells containing [xLeft, xRight].
    let left = xLeft;
    while (left > 0 && mask[row + left - 1] === 0 && data[row + left - 1] === target) left -= 1;
    let right = xRight;
    while (right < width - 1 && mask[row + right + 1] === 0 && data[row + right + 1] === target) right += 1;

    // The seed range may include already-visited cells; only mark and scan unvisited matching ones.
    let marked = false;
    for (let x = left; x <= right; x += 1) {
      if (mask[row + x] === 0 && data[row + x] === target) {
        mask[row + x] = 1;
        marked = true;
      }
    }
    if (!marked) continue;

    if (left < minX) minX = left;
    if (right > maxX) maxX = right;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    for (let pass = 0; pass < 2; pass += 1) {
      const ny = pass === 0 ? y + dy : y - dy;
      if (ny < 0 || ny >= height) continue;
      const nextRow = ny * width;
      let x = left;
      while (x <= right) {
        if (mask[nextRow + x] === 0 && data[nextRow + x] === target) {
          const runStart = x;
          while (x + 1 <= right && mask[nextRow + x + 1] === 0 && data[nextRow + x + 1] === target) x += 1;
          stack.push(ny, runStart, x, ny - y);
        }
        x += 1;
      }
    }
  }

  return { mask, bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } };
}
