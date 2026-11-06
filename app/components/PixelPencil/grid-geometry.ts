import type { BrushShape, PixelValue, ShapeKind } from "./PixelPencilTypes";

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

/**
 * Four-connected region of cells reachable from `startIndex` that share its value.
 * Used by the bucket tool for both the fill itself and its hover preview.
 */
export function collectFillRegion(
  pixels: readonly PixelValue[],
  startIndex: number,
  width: number,
  height: number,
): Set<number> {
  const grid: GridSize = { width, height };
  const targetValue = pixels[startIndex];
  const visited = new Set<number>();
  const stack = [startIndex];
  const region = new Set<number>();

  while (stack.length) {
    const index = stack.pop();
    if (index === undefined || visited.has(index)) continue;
    visited.add(index);

    if (pixels[index] !== targetValue) continue;

    region.add(index);

    const { x, y } = indexToCoords(grid, index);

    const neighbors = [
      { x: x - 1, y },
      { x: x + 1, y },
      { x, y: y - 1 },
      { x, y: y + 1 },
    ];

    for (const { x: nx, y: ny } of neighbors) {
      if (!isInBounds(grid, nx, ny)) continue;
      stack.push(coordsToIndex(grid, nx, ny));
    }
  }

  return region;
}
