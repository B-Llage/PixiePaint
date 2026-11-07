import { TRANSPARENT_DARK, TRANSPARENT_LIGHT } from "./PixelPencil.constants";
import type { PixelValue, SelectionState } from "./PixelPencilTypes";
import type { GridSize, PreviewMask } from "./grid-geometry";
import { intersectRect, TRANSPARENT_PIXEL, unionRect, type DirtyRect, type PixelBuffer } from "./pixel-buffer";

/**
 * Pure drawing helpers for the editor canvas. Every pass works in device
 * pixels with an identity transform and is bounded by the visible cells (and,
 * for the overlay, the preview masks' bounds), never by the artwork's size.
 */

/** The transient previews drawn over the artwork for one frame. */
export type OverlayFrame = {
  path: PreviewMask | null;
  brush: PreviewMask | null;
  bucket: PreviewMask | null;
  brushSizeShadow: PreviewMask | null;
  pathColor: PixelValue;
  hoverColor: PixelValue | null;
  dim: boolean;
};

/**
 * Maps artwork cells to the canvas. `origin` is where cell (0, 0) sits in CSS
 * px (`renderOffset - scrollOrigin`); `scale` is device pixels per CSS px.
 */
export type ViewTransform = {
  displayCellSize: number;
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
};

/** The artwork's pixels as a canvas the size of the artwork, uploaded from the composite buffer. */
export type CompositeSurface = {
  canvas: HTMLCanvasElement;
  imageData: ImageData;
  /** Cells changed since the last upload; `drawComposite` uploads and clears it. */
  dirty: DirtyRect | null;
};

export const DESK_BACKGROUND = "#18181b";
/** Opacity of dimmed stroke previews (`dimStrokePreview`). */
export const DIM_PREVIEW_OPACITY = 0.7;
const DIM_PREVIEW_ALPHA = Math.floor(DIM_PREVIEW_OPACITY * 255);
const BRUSH_SHADOW_RGB = [24, 24, 27] as const;
const BRUSH_SHADOW_OPACITY = 0.55;
const BRUSH_SHADOW_EDGE = "rgba(255, 255, 255, 0.8)";
const GRID_LINE_COLOR = "rgba(228, 228, 231, 0.8)";
const MIN_GRID_LINE_CELL_SIZE = 4;
const FLOATING_TRANSPARENT_TILE = "rgba(0,0,0,0.2)";
// Guards `ceil` against floating-point noise such as 300 / 0.4 = 750.0000000001.
const EDGE_EPSILON = 1e-9;

const rgbCache = new Map<string, readonly [number, number, number]>();

function hexToRgb(hex: string): readonly [number, number, number] {
  const cached = rgbCache.get(hex);
  if (cached) return cached;
  let body = hex.trim().replace(/^#/, "");
  if (body.length === 3) body = body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
  const rgb = [
    parseInt(body.slice(0, 2), 16) || 0,
    parseInt(body.slice(2, 4), 16) || 0,
    parseInt(body.slice(4, 6), 16) || 0,
  ] as const;
  rgbCache.set(hex, rgb);
  return rgb;
}

const LIGHT_RGB = hexToRgb(TRANSPARENT_LIGHT);
const DARK_RGB = hexToRgb(TRANSPARENT_DARK);
const DESK_RGB = hexToRgb(DESK_BACKGROUND);

const isLightChecker = (x: number, y: number, checkerSize: number) =>
  (Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2 === 0;

/** The cells inside the viewport, clipped to the grid; `null` when none are visible. */
export function visibleCellRect(
  grid: GridSize,
  view: ViewTransform,
  viewportWidth: number,
  viewportHeight: number,
): DirtyRect | null {
  const size = view.displayCellSize;
  if (!(size > 0) || grid.width <= 0 || grid.height <= 0) return null;
  const startX = Math.max(0, Math.floor(-view.originX / size + EDGE_EPSILON));
  const startY = Math.max(0, Math.floor(-view.originY / size + EDGE_EPSILON));
  const endX = Math.min(grid.width, Math.ceil((viewportWidth - view.originX) / size - EDGE_EPSILON));
  const endY = Math.min(grid.height, Math.ceil((viewportHeight - view.originY) / size - EDGE_EPSILON));
  if (endX <= startX || endY <= startY) return null;
  return { x: startX, y: startY, width: endX - startX, height: endY - startY };
}

/**
 * A cell corner in device pixels. Every edge is rounded the same way, so the
 * right edge of one cell is exactly the left edge of the next and adjacent
 * cells never leave antialiased seams.
 */
export function cellToDevice(view: ViewTransform, cellX: number, cellY: number): { x: number; y: number } {
  return {
    x: Math.round((cellX * view.displayCellSize + view.originX) * view.scaleX),
    y: Math.round((cellY * view.displayCellSize + view.originY) * view.scaleY),
  };
}

/** The device-pixel rect covering a cell rect. */
function rectToDevice(view: ViewTransform, rect: DirtyRect) {
  const start = cellToDevice(view, rect.x, rect.y);
  const end = cellToDevice(view, rect.x + rect.width, rect.y + rect.height);
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

// Largest checker tile (per side, in device pixels) built as a pattern; bigger
// checkers use per-checker fills, which are bounded by the visible area.
const MAX_CHECKER_TILE = 2048;

// The pattern and the device-pixel checker size it was built for, per context.
// Patterns are never scaled (Safari interpolates scaled patterns), so the tile
// is rebuilt once per zoom level rather than per frame.
const checkerPatterns = new WeakMap<
  CanvasRenderingContext2D,
  { width: number; height: number; pattern: CanvasPattern | null }
>();

function checkerPattern(ctx: CanvasRenderingContext2D, width: number, height: number): CanvasPattern | null {
  const cached = checkerPatterns.get(ctx);
  if (cached && cached.width === width && cached.height === height) return cached.pattern;
  const tile = createCanvas(2 * width, 2 * height);
  const tileContext = tile.getContext("2d");
  let pattern: CanvasPattern | null = null;
  if (tileContext) {
    tileContext.fillStyle = TRANSPARENT_LIGHT;
    tileContext.fillRect(0, 0, 2 * width, 2 * height);
    tileContext.fillStyle = TRANSPARENT_DARK;
    tileContext.fillRect(width, 0, width, height);
    tileContext.fillRect(0, height, width, height);
    pattern = ctx.createPattern(tile, "repeat");
  }
  checkerPatterns.set(ctx, { width, height, pattern });
  return pattern;
}

// Above this many visible checkers, per-checker fills give way to one scaled
// draw of a cached checkerboard bitmap (one pixel per cell). That happens at
// fractional zoom levels such as the fit-to-viewport zoom of a large grid.
const MAX_CHECKER_FILLS = 4096;

// The cell-resolution checkerboard bitmap per context, keyed by its layout.
const checkerBitmaps = new WeakMap<
  CanvasRenderingContext2D,
  { width: number; height: number; checkerSize: number; canvas: HTMLCanvasElement }
>();

/** RGBA bytes of a checkerboard with one pixel per cell. */
export function checkerboardBitmapData(width: number, height: number, checkerSize: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const rgb = isLightChecker(x, y, checkerSize) ? LIGHT_RGB : DARK_RGB;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = 255;
    }
  }
  return data;
}

function checkerBitmap(ctx: CanvasRenderingContext2D, grid: GridSize, checkerSize: number): HTMLCanvasElement | null {
  const cached = checkerBitmaps.get(ctx);
  if (cached && cached.width === grid.width && cached.height === grid.height && cached.checkerSize === checkerSize) {
    return cached.canvas;
  }
  const canvas = createCanvas(grid.width, grid.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.putImageData(
    new ImageData(checkerboardBitmapData(grid.width, grid.height, checkerSize), grid.width, grid.height),
    0,
    0,
  );
  checkerBitmaps.set(ctx, { width: grid.width, height: grid.height, checkerSize, canvas });
  return canvas;
}

const isWholePixels = (value: number) => value >= 1 && Math.abs(value - Math.round(value)) < 1e-6;

/**
 * Fills the visible cells with the transparency checkerboard (`checkerSize`
 * cells per checker). Uses one unscaled pattern fill aligned to the artwork
 * origin when a checker is a whole number of device pixels, and one fill per
 * checker otherwise (fractional zoom, huge checkers, or no pattern support).
 * When that would mean more than `MAX_CHECKER_FILLS` fills, it scales a cached
 * one-pixel-per-cell bitmap instead, so the cost stays bounded by the viewport.
 */
export function drawCheckerboard(
  ctx: CanvasRenderingContext2D,
  grid: GridSize,
  view: ViewTransform,
  visible: DirtyRect,
  checkerSize: number,
): void {
  const size = Math.max(1, Math.floor(checkerSize));
  const area = rectToDevice(view, visible);
  if (area.width <= 0 || area.height <= 0) return;
  const checkerWidth = size * view.displayCellSize * view.scaleX;
  const checkerHeight = size * view.displayCellSize * view.scaleY;
  if (
    isWholePixels(checkerWidth) &&
    isWholePixels(checkerHeight) &&
    2 * Math.round(checkerWidth) <= MAX_CHECKER_TILE &&
    2 * Math.round(checkerHeight) <= MAX_CHECKER_TILE
  ) {
    const pattern = checkerPattern(ctx, Math.round(checkerWidth), Math.round(checkerHeight));
    if (pattern) {
      const origin = cellToDevice(view, 0, 0);
      ctx.save();
      ctx.translate(origin.x, origin.y);
      ctx.fillStyle = pattern;
      ctx.fillRect(area.x - origin.x, area.y - origin.y, area.width, area.height);
      ctx.restore();
      return;
    }
  }
  const firstX = Math.floor(visible.x / size);
  const firstY = Math.floor(visible.y / size);
  const endX = visible.x + visible.width;
  const endY = visible.y + visible.height;
  const checkerCount = (Math.ceil(endX / size) - firstX) * (Math.ceil(endY / size) - firstY);
  if (checkerCount > MAX_CHECKER_FILLS) {
    const bitmap = checkerBitmap(ctx, grid, size);
    if (bitmap) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bitmap, visible.x, visible.y, visible.width, visible.height, area.x, area.y, area.width, area.height);
      return;
    }
  }
  for (let checkerY = firstY; checkerY * size < endY; checkerY += 1) {
    for (let checkerX = firstX; checkerX * size < endX; checkerX += 1) {
      const cells = intersectRect({ x: checkerX * size, y: checkerY * size, width: size, height: size }, visible);
      if (!cells) continue;
      const rect = rectToDevice(view, cells);
      ctx.fillStyle = (checkerX + checkerY) % 2 === 0 ? TRANSPARENT_LIGHT : TRANSPARENT_DARK;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
  }
}

/** A canvas the size of `buffer` with an `ImageData` over the buffer's own memory (no copy). Starts clean. */
export function createCompositeSurface(buffer: PixelBuffer): CompositeSurface {
  const canvas = createCanvas(buffer.width, buffer.height);
  // Pixel buffers are always backed by a plain ArrayBuffer (never shared memory).
  const bytes = new Uint8ClampedArray(
    buffer.data.buffer as ArrayBuffer,
    buffer.data.byteOffset,
    buffer.data.byteLength,
  );
  const imageData = new ImageData(bytes, buffer.width, buffer.height);
  return { canvas, imageData, dirty: null };
}

/**
 * Uploads the surface's dirty cells, then draws the visible cells with one
 * nearest-neighbor `drawImage` onto device-pixel-snapped edges.
 */
export function drawComposite(
  ctx: CanvasRenderingContext2D,
  surface: CompositeSurface,
  view: ViewTransform,
  visible: DirtyRect,
): void {
  const { canvas, imageData } = surface;
  if (surface.dirty) {
    const dirty = intersectRect(surface.dirty, { x: 0, y: 0, width: imageData.width, height: imageData.height });
    if (dirty) {
      canvas.getContext("2d")?.putImageData(imageData, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
    }
    surface.dirty = null;
  }
  const target = rectToDevice(view, visible);
  if (target.width <= 0 || target.height <= 0) return;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    canvas,
    visible.x,
    visible.y,
    visible.width,
    visible.height,
    target.x,
    target.y,
    target.width,
    target.height,
  );
}

const overlayCanvases = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();

/** A reusable scratch canvas per destination context, grown to at least `width` x `height`. */
function overlayCanvas(ctx: CanvasRenderingContext2D, width: number, height: number): HTMLCanvasElement {
  let canvas = overlayCanvases.get(ctx);
  if (!canvas) {
    canvas = createCanvas(width, height);
    overlayCanvases.set(ctx, canvas);
  } else if (canvas.width < width || canvas.height < height) {
    canvas.width = Math.max(canvas.width, width);
    canvas.height = Math.max(canvas.height, height);
  }
  return canvas;
}

const maskHas = (preview: PreviewMask | null, index: number) => preview !== null && preview.mask[index] !== 0;

/**
 * Draws the path, brush, bucket, and brush-size previews. One `ImageData`
 * covers the union of the masks' bounds within the visible cells; it is
 * uploaded to a reusable canvas and scaled over the artwork in one draw.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  grid: GridSize,
  view: ViewTransform,
  visible: DirtyRect,
  frame: OverlayFrame,
  checkerSize: number,
): void {
  const cellCount = grid.width * grid.height;
  const usable = (preview: PreviewMask | null) =>
    preview && preview.mask.length === cellCount && preview.bounds.width > 0 && preview.bounds.height > 0
      ? preview
      : null;
  const path = usable(frame.path);
  const brush = usable(frame.brush);
  const bucket = usable(frame.bucket);
  const shadow = usable(frame.brushSizeShadow);
  let bounds: DirtyRect | null = null;
  for (const preview of [path, brush, bucket, shadow]) {
    if (preview) bounds = unionRect(bounds, preview.bounds);
  }
  if (!bounds) return;
  const area = intersectRect(bounds, visible);
  if (!area) return;

  const size = Math.max(1, Math.floor(checkerSize));
  const imageData = new ImageData(area.width, area.height);
  const bytes = imageData.data;
  const pathRgb = frame.pathColor && frame.pathColor !== "transparent" ? hexToRgb(frame.pathColor) : null;
  const hoverRgb = frame.hoverColor && frame.hoverColor !== "transparent" ? hexToRgb(frame.hoverColor) : null;
  let offset = 0;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    const row = y * grid.width;
    for (let x = area.x; x < area.x + area.width; x += 1, offset += 4) {
      const index = row + x;
      let rgb: readonly [number, number, number] | null = null;
      let alpha = 0;
      if (maskHas(path, index)) {
        rgb = pathRgb ?? (isLightChecker(x, y, size) ? LIGHT_RGB : DARK_RGB);
        alpha = frame.dim ? DIM_PREVIEW_ALPHA : 255;
      } else if (maskHas(brush, index) || maskHas(bucket, index)) {
        if (frame.dim) {
          // Dimmed hover shading: the artwork shows at 70% over the desk background.
          rgb = DESK_RGB;
          alpha = 255 - DIM_PREVIEW_ALPHA;
        } else {
          rgb = hoverRgb ?? (isLightChecker(x, y, size) ? LIGHT_RGB : DARK_RGB);
          alpha = 255;
        }
      }
      if (maskHas(shadow, index)) {
        // The brush-size shadow composites over any other preview in the cell.
        const below = alpha / 255;
        const outAlpha = BRUSH_SHADOW_OPACITY + below * (1 - BRUSH_SHADOW_OPACITY);
        const mix = (channel: number) =>
          rgb === null
            ? BRUSH_SHADOW_RGB[channel]
            : (BRUSH_SHADOW_RGB[channel] * BRUSH_SHADOW_OPACITY + rgb[channel] * below * (1 - BRUSH_SHADOW_OPACITY)) /
              outAlpha;
        rgb = [mix(0), mix(1), mix(2)];
        alpha = Math.round(outAlpha * 255);
      }
      if (rgb === null) continue;
      bytes[offset] = rgb[0];
      bytes[offset + 1] = rgb[1];
      bytes[offset + 2] = rgb[2];
      bytes[offset + 3] = alpha;
    }
  }

  const scratch = overlayCanvas(ctx, area.width, area.height);
  const scratchContext = scratch.getContext("2d");
  if (!scratchContext) return;
  scratchContext.putImageData(imageData, 0, 0);
  const target = rectToDevice(view, area);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, 0, 0, area.width, area.height, target.x, target.y, target.width, target.height);

  if (shadow) drawShadowEdges(ctx, grid, view, area, shadow);
}

/** One-device-pixel light edges on the outside of the brush-size shadow. */
function drawShadowEdges(
  ctx: CanvasRenderingContext2D,
  grid: GridSize,
  view: ViewTransform,
  area: DirtyRect,
  shadow: PreviewMask,
): void {
  const region = intersectRect(shadow.bounds, area);
  if (!region) return;
  ctx.fillStyle = BRUSH_SHADOW_EDGE;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      const index = y * grid.width + x;
      if (shadow.mask[index] === 0) continue;
      const top = y === 0 || shadow.mask[index - grid.width] === 0;
      const bottom = y === grid.height - 1 || shadow.mask[index + grid.width] === 0;
      const left = x === 0 || shadow.mask[index - 1] === 0;
      const right = x === grid.width - 1 || shadow.mask[index + 1] === 0;
      if (!top && !bottom && !left && !right) continue;
      const cell = rectToDevice(view, { x, y, width: 1, height: 1 });
      if (top) ctx.fillRect(cell.x, cell.y, cell.width, 1);
      if (bottom) ctx.fillRect(cell.x, cell.y + cell.height - 1, cell.width, 1);
      if (left) ctx.fillRect(cell.x, cell.y, 1, cell.height);
      if (right) ctx.fillRect(cell.x + cell.width - 1, cell.y, 1, cell.height);
    }
  }
}

/** Cell grid lines over the visible cells, only when cells are at least 4 CSS px. */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  grid: GridSize,
  view: ViewTransform,
  visible: DirtyRect,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const size = view.displayCellSize;
  if (size < MIN_GRID_LINE_CELL_SIZE) return;
  ctx.save();
  ctx.setTransform(view.scaleX, 0, 0, view.scaleY, 0, 0);
  ctx.beginPath();
  ctx.rect(view.originX, view.originY, grid.width * size, grid.height * size);
  ctx.clip();
  ctx.strokeStyle = GRID_LINE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let column = visible.x; column <= visible.x + visible.width; column += 1) {
    const x = column * size + view.originX + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewportHeight);
  }
  for (let row = visible.y; row <= visible.y + visible.height; row += 1) {
    const y = row * size + view.originY + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(viewportWidth, y);
  }
  ctx.stroke();
  ctx.restore();
}

// A floating selection's pixels never change while it is dragged (a new
// selection gets a new `data` array), so its canvas is built once per array.
const selectionCanvases = new WeakMap<Uint32Array, HTMLCanvasElement>();

function selectionCanvas(selection: SelectionState): HTMLCanvasElement | null {
  const cached = selectionCanvases.get(selection.data);
  if (cached) return cached;
  const { width, height } = selection.rect;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  // Empty and transparent cells both have alpha 0 in the packed format.
  const bytes = new Uint8ClampedArray(selection.data.length * 4);
  bytes.set(new Uint8Array(selection.data.buffer, selection.data.byteOffset, selection.data.byteLength));
  context.putImageData(new ImageData(bytes, width, height), 0, 0);
  selectionCanvases.set(selection.data, canvas);
  return canvas;
}

/**
 * Draws a floating selection's pixels at its offset rect in one blit, then
 * marks its explicitly transparent cells with a faint checker tile. Only
 * cells inside `visible` (when given) get tiles.
 */
export function drawFloatingSelection(
  ctx: CanvasRenderingContext2D,
  selection: SelectionState,
  view: ViewTransform,
  visible?: DirtyRect | null,
): void {
  if (!selection.isFloating) return;
  const { rect, offset, data } = selection;
  if (rect.width <= 0 || rect.height <= 0 || data.length < rect.width * rect.height) return;
  const placed = { x: rect.x + offset.dx, y: rect.y + offset.dy, width: rect.width, height: rect.height };
  const canvas = selectionCanvas(selection);
  if (!canvas) return;
  const target = rectToDevice(view, placed);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, rect.width, rect.height, target.x, target.y, target.width, target.height);

  // `null` means no cells are on screen, so there are no transparent tiles to draw.
  if (visible === null) return;
  const tiled = visible ? intersectRect(placed, visible) : placed;
  if (!tiled) return;
  ctx.fillStyle = FLOATING_TRANSPARENT_TILE;
  for (let y = tiled.y; y < tiled.y + tiled.height; y += 1) {
    for (let x = tiled.x; x < tiled.x + tiled.width; x += 1) {
      if (data[(y - placed.y) * rect.width + (x - placed.x)] !== TRANSPARENT_PIXEL) continue;
      const cell = rectToDevice(view, { x, y, width: 1, height: 1 });
      const halfWidth = Math.max(1, Math.round(cell.width / 2));
      const halfHeight = Math.max(1, Math.round(cell.height / 2));
      ctx.fillRect(cell.x, cell.y, halfWidth, halfHeight);
      ctx.fillRect(cell.x + halfWidth, cell.y + halfHeight, cell.width - halfWidth, cell.height - halfHeight);
    }
  }
}
