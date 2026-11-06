import type { PixelValue } from "./PixelPencilTypes";

/**
 * Typed-array pixel storage. Each cell is one packed RGBA `Uint32` in ImageData byte order,
 * so a `Uint32Array` over the buffer can back an `ImageData` directly. Pure: no React, no DOM.
 */
export type PixelBuffer = { width: number; height: number; data: Uint32Array };
export type DirtyRect = { x: number; y: number; width: number; height: number };

/** A cell that was never painted. */
export const EMPTY_PIXEL = 0;
/** A cell explicitly painted as "transparent" (alpha 0, so it never collides with a color). */
export const TRANSPARENT_PIXEL = 0x00000001;

const packScratchBytes = new Uint8ClampedArray(4);
const packScratchWord = new Uint32Array(packScratchBytes.buffer);

const packCache = new Map<string, number>();
const unpackCache = new Map<number, string>();

const expandHex = (hex: string) => {
  const body = hex.trim().toLowerCase().replace(/^#/, "");
  if (body.length === 3) {
    return body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  }
  return body;
};

/** Packs `#rgb` / `#rrggbb` (any case) into an opaque ImageData-ordered value. */
export function packColor(hex: string): number {
  const body = expandHex(hex);
  const cached = packCache.get(body);
  if (cached !== undefined) return cached;
  packScratchBytes[0] = parseInt(body.slice(0, 2), 16);
  packScratchBytes[1] = parseInt(body.slice(2, 4), 16);
  packScratchBytes[2] = parseInt(body.slice(4, 6), 16);
  packScratchBytes[3] = 255;
  const packed = packScratchWord[0];
  packCache.set(body, packed);
  return packed;
}

export function unpackColor(value: number): PixelValue {
  if (value === EMPTY_PIXEL) return null;
  if (value === TRANSPARENT_PIXEL) return "transparent";
  const cached = unpackCache.get(value);
  if (cached !== undefined) return cached;
  packScratchWord[0] = value;
  const hex = (byte: number) => byte.toString(16).padStart(2, "0");
  const color = `#${hex(packScratchBytes[0])}${hex(packScratchBytes[1])}${hex(packScratchBytes[2])}`;
  unpackCache.set(value, color);
  return color;
}

export function toPackedValue(value: PixelValue): number {
  if (value === null) return EMPTY_PIXEL;
  if (value === "transparent") return TRANSPARENT_PIXEL;
  return packColor(value);
}

export const isPaintedPixel = (value: number) => value !== EMPTY_PIXEL && value !== TRANSPARENT_PIXEL;

export const createBuffer = (width: number, height: number): PixelBuffer => ({
  width,
  height,
  data: new Uint32Array(width * height),
});

export const cloneBuffer = (buffer: PixelBuffer): PixelBuffer => ({
  width: buffer.width,
  height: buffer.height,
  data: buffer.data.slice(),
});

export function isBufferEmpty(buffer: PixelBuffer): boolean {
  const { data } = buffer;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== EMPTY_PIXEL) return false;
  }
  return true;
}

const rectFromBounds = (minX: number, minY: number, maxX: number, maxY: number): DirtyRect => ({
  x: minX,
  y: minY,
  width: maxX - minX + 1,
  height: maxY - minY + 1,
});

export function rectFromIndices(buffer: PixelBuffer, indices: ArrayLike<number>): DirtyRect | null {
  if (indices.length === 0) return null;
  const { width } = buffer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    const y = Math.floor(index / width);
    const x = index - y * width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return rectFromBounds(minX, minY, maxX, maxY);
}

export function unionRect(a: DirtyRect | null, b: DirtyRect | null): DirtyRect | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function intersectRect(rect: DirtyRect, bounds: DirtyRect): DirtyRect | null {
  const minX = Math.max(rect.x, bounds.x);
  const minY = Math.max(rect.y, bounds.y);
  const maxX = Math.min(rect.x + rect.width, bounds.x + bounds.width);
  const maxY = Math.min(rect.y + rect.height, bounds.y + bounds.height);
  if (maxX <= minX || maxY <= minY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const bufferRect = (buffer: PixelBuffer): DirtyRect => ({ x: 0, y: 0, width: buffer.width, height: buffer.height });

/** Writes `value` into the listed cells; returns the bounding rect of cells whose value changed. */
export function fillCells(buffer: PixelBuffer, indices: ArrayLike<number>, value: number): DirtyRect | null {
  const { data, width } = buffer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    if (data[index] === value) continue;
    data[index] = value;
    const y = Math.floor(index / width);
    const x = index - y * width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < minX ? null : rectFromBounds(minX, minY, maxX, maxY);
}

/**
 * Writes `value` into cells set in the canvas-sized `mask` that lie inside `bounds` (clipped to the
 * buffer); returns the bounding rect of cells whose value changed.
 */
export function fillMask(buffer: PixelBuffer, mask: Uint8Array, bounds: DirtyRect, value: number): DirtyRect | null {
  const clipped = intersectRect(bounds, bufferRect(buffer));
  if (!clipped) return null;
  const { data, width } = buffer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = clipped.y; y < clipped.y + clipped.height; y++) {
    const rowStart = y * width;
    for (let x = clipped.x; x < clipped.x + clipped.width; x++) {
      const index = rowStart + x;
      if (mask[index] === 0 || data[index] === value) continue;
      data[index] = value;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < minX ? null : rectFromBounds(minX, minY, maxX, maxY);
}

/** Row-major copy of `rect` (must lie inside the buffer). */
export function extractRect(buffer: PixelBuffer, rect: DirtyRect): Uint32Array {
  const out = new Uint32Array(rect.width * rect.height);
  for (let row = 0; row < rect.height; row++) {
    const start = (rect.y + row) * buffer.width + rect.x;
    out.set(buffer.data.subarray(start, start + rect.width), row * rect.width);
  }
  return out;
}

/** Inverse of `extractRect`. */
export function writeRect(buffer: PixelBuffer, rect: DirtyRect, data: Uint32Array): void {
  for (let row = 0; row < rect.height; row++) {
    const start = (rect.y + row) * buffer.width + rect.x;
    buffer.data.set(data.subarray(row * rect.width, (row + 1) * rect.width), start);
  }
}

/** Copies `rect` from `src` to the same place in `dst` (same-size buffers). */
export function copyRect(src: PixelBuffer, dst: PixelBuffer, rect: DirtyRect): void {
  for (let row = 0; row < rect.height; row++) {
    const start = (rect.y + row) * src.width + rect.x;
    dst.data.set(src.data.subarray(start, start + rect.width), start);
  }
}

/**
 * For every cell (x, y) of `rect` (clipped to `dst`), writes `src[x - dx, y - dy]`, or
 * `EMPTY_PIXEL` where that source cell is off the grid. Same-size buffers. Cells outside `rect`
 * are untouched, so the cost is bounded by `rect`: this is `translateBuffer` restricted to a rect.
 */
export function copyShiftedRect(src: PixelBuffer, dst: PixelBuffer, rect: DirtyRect, dx: number, dy: number): void {
  const area = intersectRect(rect, bufferRect(dst));
  if (!area) return;
  const { width } = dst;
  const left = area.x;
  const right = area.x + area.width;
  // Destination columns whose source column x - dx lies in [0, src.width).
  const spanStart = Math.min(right, Math.max(left, dx));
  const spanEnd = Math.max(spanStart, Math.min(right, src.width + dx));
  for (let y = area.y; y < area.y + area.height; y++) {
    const rowStart = y * width;
    const sourceY = y - dy;
    if (sourceY < 0 || sourceY >= src.height || spanEnd <= spanStart) {
      dst.data.fill(EMPTY_PIXEL, rowStart + left, rowStart + right);
      continue;
    }
    if (spanStart > left) dst.data.fill(EMPTY_PIXEL, rowStart + left, rowStart + spanStart);
    const sourceRow = sourceY * src.width;
    dst.data.set(src.data.subarray(sourceRow + spanStart - dx, sourceRow + spanEnd - dx), rowStart + spanStart);
    if (spanEnd < right) dst.data.fill(EMPTY_PIXEL, rowStart + spanEnd, rowStart + right);
  }
}

/**
 * Clears `dst`, then copies `src` shifted by (dx, dy), clipping whatever leaves the canvas.
 * Whole-canvas work: for one-shot uses only, never per pointer step (see `copyShiftedRect`).
 */
export function translateBuffer(src: PixelBuffer, dst: PixelBuffer, dx: number, dy: number): void {
  dst.data.fill(EMPTY_PIXEL);
  const startX = Math.max(0, -dx);
  const endX = Math.min(src.width, src.width - dx);
  if (endX <= startX) return;
  const startY = Math.max(0, -dy);
  const endY = Math.min(src.height, src.height - dy);
  for (let y = startY; y < endY; y++) {
    const from = y * src.width;
    dst.data.set(src.data.subarray(from + startX, from + endX), (y + dy) * dst.width + startX + dx);
  }
}

/** Bounding rect of every non-empty cell (transparent paint counts), or null for an empty buffer. */
export function nonEmptyBounds(buffer: PixelBuffer): DirtyRect | null {
  const { data, width, height } = buffer;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (data[rowStart + x] === EMPTY_PIXEL) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      maxY = y;
    }
  }
  return maxX < minX ? null : rectFromBounds(minX, minY, maxX, maxY);
}

/** New buffer of the given size keeping `src` anchored top-left; new cells are empty. */
export function resizeBuffer(src: PixelBuffer, width: number, height: number): PixelBuffer {
  const out = createBuffer(width, height);
  const copyWidth = Math.min(src.width, width);
  const copyHeight = Math.min(src.height, height);
  for (let y = 0; y < copyHeight; y++) {
    out.data.set(src.data.subarray(y * src.width, y * src.width + copyWidth), y * width);
  }
  return out;
}

/**
 * Flattens visible layers (index 0 is the bottom) into `composite` inside `rect` (null = whole buffer).
 * The topmost painted pixel wins; cells with none become `EMPTY_PIXEL`.
 */
export function composeInto(
  composite: PixelBuffer,
  layers: ReadonlyArray<{ visible: boolean; pixels: PixelBuffer }>,
  rect: DirtyRect | null,
): void {
  const area = rect ? intersectRect(rect, bufferRect(composite)) : bufferRect(composite);
  if (!area) return;
  const { width } = composite;
  for (let y = area.y; y < area.y + area.height; y++) {
    const rowStart = y * width;
    for (let x = area.x; x < area.x + area.width; x++) {
      const index = rowStart + x;
      let result = EMPTY_PIXEL;
      for (let l = layers.length - 1; l >= 0; l--) {
        const layer = layers[l];
        if (!layer.visible) continue;
        const value = layer.pixels.data[index];
        if (isPaintedPixel(value)) {
          result = value;
          break;
        }
      }
      composite.data[index] = result;
    }
  }
}
