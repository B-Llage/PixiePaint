import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cellToDevice,
  createCompositeSurface,
  drawCheckerboard,
  drawComposite,
  drawFloatingSelection,
  drawGridLines,
  drawOverlay,
  visibleCellRect,
  type OverlayFrame,
  type ViewTransform,
} from "./grid-renderer";
import { createMask, stampCells, type PreviewMask } from "./grid-geometry";
import { TRANSPARENT_DARK, TRANSPARENT_LIGHT } from "./PixelPencil.constants";
import { createBuffer, packColor, TRANSPARENT_PIXEL } from "./pixel-buffer";
import type { SelectionState } from "./PixelPencilTypes";

/** jsdom has no ImageData without the canvas package; this mirrors the two constructors we use. */
class ImageDataStub {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(dataOrWidth: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = width;
      this.data = new Uint8ClampedArray(dataOrWidth * width * 4);
    } else {
      this.data = dataOrWidth;
      this.width = width;
      this.height = height ?? dataOrWidth.length / 4 / width;
    }
  }
}

type Call = { name: string; args: unknown[]; fillStyle?: unknown };

/** A hand-written 2D context that records every drawing call. */
function createContextStub(options: { pattern?: boolean } = {}) {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args, fillStyle: context.fillStyle });
  };
  const context = {
    fillStyle: "" as unknown,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    calls,
    setTransform: record("setTransform"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    rect: record("rect"),
    clip: record("clip"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    putImageData: record("putImageData"),
    drawImage: (...args: unknown[]) => {
      calls.push({ name: "drawImage", args: [...args], fillStyle: context.imageSmoothingEnabled });
    },
    createPattern: vi.fn<(tile: HTMLCanvasElement) => { kind: string } | null>(() => (options.pattern ? { kind: "pattern" } : null)),
  };
  return context;
}

type ContextStub = ReturnType<typeof createContextStub>;
const asContext = (stub: ContextStub) => stub as unknown as CanvasRenderingContext2D;
const callsNamed = (stub: ContextStub, name: string) => stub.calls.filter((call) => call.name === name);

const view = (overrides: Partial<ViewTransform> = {}): ViewTransform => ({
  displayCellSize: 10,
  originX: 0,
  originY: 0,
  scaleX: 1,
  scaleY: 1,
  ...overrides,
});

const maskOf = (grid: { width: number; height: number }, cells: number[]): PreviewMask => {
  const mask = createMask(grid);
  const bounds = stampCells(mask, grid, cells, null);
  return { mask, bounds: bounds! };
};

const emptyFrame = (overrides: Partial<OverlayFrame> = {}): OverlayFrame => ({
  path: null,
  brush: null,
  bucket: null,
  brushSizeShadow: null,
  pathColor: "#000000",
  hoverColor: "#000000",
  dim: false,
  ...overrides,
});

/** Reads the RGBA bytes the overlay wrote for a cell, from the overlay canvas the context drew. */
function overlayPixel(stub: ContextStub, cellX: number, cellY: number, origin = 30, cellSize = 10) {
  const [canvas, , , , , dx, dy] = callsNamed(stub, "drawImage")[0].args as [HTMLCanvasElement, ...number[]];
  const overlay = (canvas as unknown as { __stub: ContextStub }).__stub;
  const imageData = callsNamed(overlay, "putImageData").at(-1)!.args[0] as ImageDataStub;
  const rectX = (dx - origin) / cellSize;
  const rectY = (dy - origin) / cellSize;
  const offset = ((cellY - rectY) * imageData.width + (cellX - rectX)) * 4;
  return Array.from(imageData.data.slice(offset, offset + 4));
}

let overlayContexts: ContextStub[] = [];

beforeEach(() => {
  overlayContexts = [];
  vi.stubGlobal("ImageData", ImageDataStub);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(this: HTMLCanvasElement) {
    const existing = (this as unknown as { __stub?: ContextStub }).__stub;
    if (existing) return asContext(existing);
    const stub = createContextStub();
    (this as unknown as { __stub?: ContextStub }).__stub = stub;
    overlayContexts.push(stub);
    return asContext(stub);
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("visibleCellRect", () => {
  it("visibleCellRect clips to the grid and the viewport", () => {
    const grid = { width: 32, height: 16 };
    // Artwork panned 25 px left and 5 px down: cells 2.. are visible horizontally.
    expect(visibleCellRect(grid, view({ originX: -25, originY: 5 }), 100, 100)).toEqual({
      x: 2,
      y: 0,
      width: 11,
      height: 10,
    });
    // Fully fitted artwork is clipped to the grid.
    expect(visibleCellRect({ width: 4, height: 4 }, view({ originX: 30, originY: 30 }), 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 4,
      height: 4,
    });
    // Panned entirely out of view.
    expect(visibleCellRect(grid, view({ originX: 200 }), 100, 100)).toBeNull();
    expect(visibleCellRect(grid, view({ displayCellSize: 0 }), 100, 100)).toBeNull();
  });
});

describe("cellToDevice", () => {
  it("cellToDevice gives adjacent cells a shared edge", () => {
    const transform = view({ displayCellSize: 2.5, originX: 0.3, originY: 0.7, scaleX: 2, scaleY: 2 });
    for (let cell = 0; cell < 8; cell += 1) {
      const left = cellToDevice(transform, cell, cell);
      const right = cellToDevice(transform, cell + 1, cell + 1);
      // The right edge of a cell is computed exactly as the left edge of the next one.
      expect(Number.isInteger(left.x)).toBe(true);
      expect(Number.isInteger(left.y)).toBe(true);
      expect(right.x).toBe(Math.round(((cell + 1) * 2.5 + 0.3) * 2));
      expect(right.y).toBe(Math.round(((cell + 1) * 2.5 + 0.7) * 2));
    }
    expect(cellToDevice(transform, 1, 0).x).toBe(Math.round((2.5 + 0.3) * 2));
  });
});

describe("drawComposite", () => {
  it("drawComposite uploads only the dirty rect and draws once", () => {
    const buffer = createBuffer(8, 8);
    buffer.data[9] = packColor("#ff0000");
    const surface = createCompositeSurface(buffer);
    // The ImageData shares the buffer's memory: no copy.
    expect(surface.imageData.data.buffer).toBe(buffer.data.buffer);
    surface.dirty = { x: 1, y: 1, width: 2, height: 3 };
    const context = createContextStub();

    drawComposite(asContext(context), surface, view({ originX: -15, originY: 5 }), { x: 1, y: 0, width: 7, height: 8 });

    const surfaceContext = overlayContexts[0];
    expect(callsNamed(surfaceContext, "putImageData")).toEqual([
      expect.objectContaining({ args: [surface.imageData, 0, 0, 1, 1, 2, 3] }),
    ]);
    expect(surface.dirty).toBeNull();
    const draws = callsNamed(context, "drawImage");
    expect(draws).toHaveLength(1);
    expect(draws[0].args).toEqual([surface.canvas, 1, 0, 7, 8, -5, 5, 70, 80]);
    // Nearest-neighbor scaling.
    expect(draws[0].fillStyle).toBe(false);

    // Nothing dirty: no upload, still one blit.
    drawComposite(asContext(context), surface, view(), { x: 0, y: 0, width: 8, height: 8 });
    expect(callsNamed(surfaceContext, "putImageData")).toHaveLength(1);
    expect(callsNamed(context, "drawImage")).toHaveLength(2);
  });

  it("draws the composite with one drawImage at fractional cell sizes", () => {
    const grid = { width: 2048, height: 2048 };
    const transform = view({ displayCellSize: 0.4 });
    const visible = visibleCellRect(grid, transform, 300, 300)!;
    expect(visible).toEqual({ x: 0, y: 0, width: 750, height: 750 });
    const surface = createCompositeSurface(createBuffer(2048, 2048));
    surface.dirty = { x: 0, y: 0, width: 2048, height: 2048 };
    const context = createContextStub();

    drawComposite(asContext(context), surface, transform, visible);

    const draws = callsNamed(context, "drawImage");
    expect(draws).toHaveLength(1);
    const numbers = draws[0].args.slice(1) as number[];
    expect(numbers.every((value) => Number.isFinite(value))).toBe(true);
    expect(numbers.slice(0, 4)).toEqual([0, 0, 750, 750]);
    expect(numbers.slice(4)).toEqual([0, 0, 300, 300]);
  });
});

describe("drawCheckerboard", () => {
  it("fills the visible cells with a cached pattern aligned to the artwork", () => {
    const context = createContextStub({ pattern: true });
    const grid = { width: 4, height: 4 };
    const transform = view({ originX: 30, originY: 30 });
    drawCheckerboard(asContext(context), grid, transform, { x: 0, y: 0, width: 4, height: 4 }, 1);
    drawCheckerboard(asContext(context), grid, transform, { x: 0, y: 0, width: 4, height: 4 }, 1);

    expect(context.createPattern).toHaveBeenCalledTimes(1);
    const fills = callsNamed(context, "fillRect");
    expect(fills).toHaveLength(2);
    expect(fills[0].fillStyle).toEqual({ kind: "pattern" });
    expect(callsNamed(context, "translate")[0].args).toEqual([30, 30]);
    // One checker is one cell (10 device px): the tile is built at that size, so the pattern is never scaled.
    expect(callsNamed(context, "scale")).toHaveLength(0);
    expect(fills[0].args).toEqual([0, 0, 40, 40]);
  });

  it("builds the checker tile at device size and never scales the pattern", () => {
    const context = createContextStub({ pattern: true });
    const grid = { width: 8, height: 8 };
    drawCheckerboard(asContext(context), grid, view({ displayCellSize: 10, scaleX: 2, scaleY: 2, originX: 6, originY: 8 }), { x: 0, y: 0, width: 8, height: 8 }, 2);

    expect(context.createPattern).toHaveBeenCalledTimes(1);
    const tile = context.createPattern.mock.calls[0][0] as unknown as HTMLCanvasElement;
    expect(tile.width).toBe(80);
    expect(tile.height).toBe(80);
    expect(callsNamed(context, "scale")).toHaveLength(0);
    expect(callsNamed(context, "translate")[0].args).toEqual([12, 16]);
  });

  it("rebuilds the tile when the checker size changes and reuses it otherwise", () => {
    const context = createContextStub({ pattern: true });
    const grid = { width: 4, height: 4 };
    const visible = { x: 0, y: 0, width: 4, height: 4 };
    drawCheckerboard(asContext(context), grid, view(), visible, 1);
    drawCheckerboard(asContext(context), grid, view(), visible, 1);
    expect(context.createPattern).toHaveBeenCalledTimes(1);
    drawCheckerboard(asContext(context), grid, view({ displayCellSize: 12 }), visible, 1);
    expect(context.createPattern).toHaveBeenCalledTimes(2);
  });

  it("uses per-checker fills at fractional checker sizes", () => {
    const context = createContextStub({ pattern: true });
    drawCheckerboard(asContext(context), { width: 4, height: 4 }, view({ displayCellSize: 2.5 }), { x: 0, y: 0, width: 4, height: 4 }, 1);
    expect(context.createPattern).not.toHaveBeenCalled();
    expect(callsNamed(context, "scale")).toHaveLength(0);
    const fills = callsNamed(context, "fillRect");
    expect(fills).toHaveLength(16);
    expect(fills[0].fillStyle).toBe(TRANSPARENT_LIGHT);
    expect(fills[1].fillStyle).toBe(TRANSPARENT_DARK);
  });

  it("falls back to one fill per checker when patterns are unavailable", () => {
    const context = createContextStub();
    drawCheckerboard(asContext(context), { width: 4, height: 4 }, view({ originX: 30, originY: 30 }), { x: 0, y: 0, width: 4, height: 4 }, 2);
    const fills = callsNamed(context, "fillRect");
    expect(fills).toHaveLength(4);
    expect(fills[0]).toMatchObject({ args: [30, 30, 20, 20], fillStyle: TRANSPARENT_LIGHT });
    expect(fills[1]).toMatchObject({ args: [50, 30, 20, 20], fillStyle: TRANSPARENT_DARK });
  });
});

describe("drawOverlay", () => {
  const grid = { width: 4, height: 4 };
  const visible = { x: 0, y: 0, width: 4, height: 4 };

  const drawFrame = (frame: OverlayFrame) => {
    const context = createContextStub();
    drawOverlay(asContext(context), grid, view({ originX: 30, originY: 30 }), visible, frame, 1);
    return context;
  };

  it("drawOverlay writes the path color and checker color for erase previews", () => {
    const path = maskOf(grid, [5, 6]);
    let context = drawFrame(emptyFrame({ path, pathColor: "#ff8800" }));
    const draws = callsNamed(context, "drawImage");
    expect(draws).toHaveLength(1);
    // Only the union of the masks' bounds is uploaded and drawn.
    expect(draws[0].args.slice(1)).toEqual([0, 0, 2, 1, 40, 40, 20, 10]);
    expect(overlayPixel(context, 1, 1)).toEqual([0xff, 0x88, 0x00, 255]);

    // An erase (null) or transparent stroke previews the checker color of each cell.
    context = drawFrame(emptyFrame({ path, pathColor: null }));
    expect(overlayPixel(context, 1, 1)).toEqual([0xd4, 0xd4, 0xd8, 255]);
    expect(overlayPixel(context, 2, 1)).toEqual([0x9c, 0xa3, 0xaf, 255]);
    context = drawFrame(emptyFrame({ path, pathColor: "transparent" }));
    expect(overlayPixel(context, 1, 1)).toEqual([0xd4, 0xd4, 0xd8, 255]);

    // Dimmed stroke previews are translucent.
    context = drawFrame(emptyFrame({ path, pathColor: "#ff8800", dim: true }));
    expect(overlayPixel(context, 1, 1)).toEqual([0xff, 0x88, 0x00, 178]);
  });

  it("shows the hover color for brush and bucket previews, or shades the cell when dimmed", () => {
    for (const key of ["brush", "bucket"] as const) {
      const mask = maskOf(grid, [5]);
      let context = drawFrame(emptyFrame({ [key]: mask, hoverColor: "#ff8800" }));
      expect(overlayPixel(context, 1, 1)).toEqual([0xff, 0x88, 0x00, 255]);

      // The eraser (null hover color) and transparent paint preview the checkerboard.
      context = drawFrame(emptyFrame({ [key]: mask, hoverColor: null }));
      expect(overlayPixel(context, 1, 1)).toEqual([0xd4, 0xd4, 0xd8, 255]);

      // Dimmed hover keeps the artwork visible at 70% over the desk background.
      context = drawFrame(emptyFrame({ [key]: mask, hoverColor: "#ff8800", dim: true }));
      expect(overlayPixel(context, 1, 1)).toEqual([0x18, 0x18, 0x1b, 77]);
    }
  });

  it("draws the path preview over the hover preview", () => {
    const context = drawFrame(emptyFrame({ path: maskOf(grid, [5]), brush: maskOf(grid, [5]), pathColor: "#000000", hoverColor: "#ff0000" }));
    expect(overlayPixel(context, 1, 1)).toEqual([0, 0, 0, 255]);
  });

  it("draws the brush size shadow with a light outer edge", () => {
    const context = drawFrame(emptyFrame({ brushSizeShadow: maskOf(grid, [5, 6]) }));
    expect(overlayPixel(context, 1, 1)).toEqual([24, 24, 27, 140]);
    const edges = callsNamed(context, "fillRect").filter((call) => call.fillStyle === "rgba(255, 255, 255, 0.8)");
    // Cell 5 has top, bottom, and left outer edges; its right neighbor is inside the shadow.
    expect(edges.map((call) => call.args)).toEqual(
      expect.arrayContaining([
        [40, 40, 10, 1],
        [40, 49, 10, 1],
        [40, 40, 1, 10],
        [59, 40, 1, 10],
      ]),
    );
    expect(edges.some((call) => (call.args as number[])[0] === 49 && (call.args as number[])[2] === 1)).toBe(false);
  });

  it("draws nothing without preview masks or outside the visible cells", () => {
    expect(callsNamed(drawFrame(emptyFrame()), "drawImage")).toHaveLength(0);
    const context = createContextStub();
    drawOverlay(asContext(context), grid, view(), { x: 2, y: 2, width: 2, height: 2 }, emptyFrame({ brush: maskOf(grid, [0]) }), 1);
    expect(callsNamed(context, "drawImage")).toHaveLength(0);
  });
});

describe("drawGridLines", () => {
  it("drawGridLines draws nothing below a 4px cell size", () => {
    const context = createContextStub();
    drawGridLines(asContext(context), { width: 4, height: 4 }, view({ displayCellSize: 3.9 }), { x: 0, y: 0, width: 4, height: 4 }, 100, 100);
    expect(context.calls).toHaveLength(0);

    drawGridLines(asContext(context), { width: 4, height: 4 }, view({ displayCellSize: 4 }), { x: 0, y: 0, width: 4, height: 4 }, 100, 100);
    // Five vertical and five horizontal lines in one stroke, clipped to the artwork.
    expect(callsNamed(context, "moveTo")).toHaveLength(10);
    expect(callsNamed(context, "stroke")).toHaveLength(1);
    expect(callsNamed(context, "rect")[0].args).toEqual([0, 0, 16, 16]);
  });
});

describe("drawFloatingSelection", () => {
  it("blits the floating pixels at the offset rect and tiles transparent cells", () => {
    const selection: SelectionState = {
      rect: { x: 0, y: 0, width: 2, height: 1 },
      offset: { dx: 1, dy: 2 },
      data: new Uint32Array([packColor("#ff0000"), TRANSPARENT_PIXEL]),
      isFloating: true,
    };
    const context = createContextStub();
    drawFloatingSelection(asContext(context), selection, view({ originX: 30, originY: 30 }));

    const draws = callsNamed(context, "drawImage");
    expect(draws).toHaveLength(1);
    expect(draws[0].args.slice(1)).toEqual([0, 0, 2, 1, 40, 50, 20, 10]);
    const selectionCanvasContext = overlayContexts.at(-1)!;
    const uploaded = callsNamed(selectionCanvasContext, "putImageData")[0].args[0] as ImageDataStub;
    expect(Array.from(uploaded.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
    expect(uploaded.data[7]).toBe(0);

    const tiles = callsNamed(context, "fillRect");
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((call) => (call.args as number[])[0] >= 50 && (call.args as number[])[0] < 60)).toBe(true);

    // With no cells on screen the transparent tiles are skipped.
    const offscreen = createContextStub();
    drawFloatingSelection(asContext(offscreen), selection, view({ originX: 30, originY: 30 }), null);
    expect(callsNamed(offscreen, "fillRect")).toHaveLength(0);

    // A selection that is not floating draws nothing.
    const idle = createContextStub();
    drawFloatingSelection(asContext(idle), { ...selection, isFloating: false }, view());
    expect(idle.calls).toHaveLength(0);
  });
});
