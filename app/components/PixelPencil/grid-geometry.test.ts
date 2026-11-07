import { describe, expect, it } from "vitest";

import {
  clearScratchMask,
  scratchPreview,
  stampScratch,
  brushBounds,
  clearMaskRect,
  collectFillMask,
  computeBrushIndices,
  computeLineIndices,
  computeShapeCells,
  createMask,
  MAX_SEGMENT_STEPS,
  stampCells,
  traceWorldSegment,
} from "./grid-geometry";
import { createBuffer, packColor, TRANSPARENT_PIXEL, type PixelBuffer } from "./pixel-buffer";
import type { PixelValue } from "./PixelPencilTypes";

const grid = { width: 5, height: 5 };
const at = (x: number, y: number) => y * grid.width + x;
const sorted = (cells: Iterable<number>) => Array.from(cells).sort((a, b) => a - b);

describe("computeBrushIndices", () => {
  it("returns only the center cell for a size-1 brush", () => {
    expect(computeBrushIndices(grid, at(2, 2), 1, "square")).toEqual([at(2, 2)]);
    expect(computeBrushIndices(grid, at(2, 2), 1, "circle")).toEqual([at(2, 2)]);
  });

  it("extends an even-sized square brush down and right of the center", () => {
    expect(sorted(computeBrushIndices(grid, at(1, 1), 2, "square"))).toEqual([
      at(1, 1),
      at(2, 1),
      at(1, 2),
      at(2, 2),
    ]);
  });

  it("clips the footprint at a grid corner", () => {
    expect(sorted(computeBrushIndices(grid, at(0, 0), 3, "square"))).toEqual([
      at(0, 0),
      at(1, 0),
      at(0, 1),
      at(1, 1),
    ]);
    expect(sorted(computeBrushIndices(grid, at(4, 4), 3, "square"))).toEqual([
      at(3, 3),
      at(4, 3),
      at(3, 4),
      at(4, 4),
    ]);
  });

  it("keeps a size-3 circle as a full 3x3 block and drops the corners of a size-5 circle", () => {
    expect(computeBrushIndices(grid, at(2, 2), 3, "circle")).toEqual(
      computeBrushIndices(grid, at(2, 2), 3, "square"),
    );

    const circle = sorted(computeBrushIndices(grid, at(2, 2), 5, "circle"));
    const corners = [at(0, 0), at(4, 0), at(0, 4), at(4, 4)];
    expect(circle).toHaveLength(21);
    for (const corner of corners) {
      expect(circle).not.toContain(corner);
    }
    expect(circle).toContain(at(1, 0));
  });

  it("never produces indices outside the grid for large brushes", () => {
    const indices = computeBrushIndices(grid, at(4, 0), 9, "circle");
    expect(indices.length).toBeGreaterThan(0);
    for (const index of indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(grid.width * grid.height);
    }
  });
});

describe("computeLineIndices", () => {
  it("returns the single cell for a zero-length line", () => {
    expect(computeLineIndices(grid, at(3, 3), at(3, 3))).toEqual([at(3, 3)]);
  });

  it("walks a horizontal line from start to end inclusive", () => {
    expect(computeLineIndices(grid, at(0, 2), at(3, 2))).toEqual([at(0, 2), at(1, 2), at(2, 2), at(3, 2)]);
    expect(computeLineIndices(grid, at(3, 2), at(0, 2))).toEqual([at(3, 2), at(2, 2), at(1, 2), at(0, 2)]);
  });

  it("draws an unbroken diagonal", () => {
    expect(computeLineIndices(grid, at(0, 0), at(3, 3))).toEqual([at(0, 0), at(1, 1), at(2, 2), at(3, 3)]);
  });

  it("drops cells that fall outside the grid", () => {
    const narrow = { width: 3, height: 1 };
    // Index 5 decodes to x=2, y=1, which is below the single-row grid.
    expect(computeLineIndices(narrow, 0, 5)).toEqual([0, 1]);
  });
});

describe("computeShapeCells", () => {
  it("returns the single cell for a 1x1 shape of every kind, filled or not", () => {
    for (const shape of ["square", "circle", "triangle"] as const) {
      expect(computeShapeCells(grid, at(2, 2), at(2, 2), shape, true)).toEqual([at(2, 2)]);
      expect(computeShapeCells(grid, at(2, 2), at(2, 2), shape, false)).toEqual([at(2, 2)]);
    }
  });

  it("fills the bounding box for a square regardless of drag direction", () => {
    const expected = [at(1, 1), at(2, 1), at(3, 1), at(1, 2), at(2, 2), at(3, 2), at(1, 3), at(2, 3), at(3, 3)];
    expect(sorted(computeShapeCells(grid, at(1, 1), at(3, 3), "square", true))).toEqual(expected);
    expect(sorted(computeShapeCells(grid, at(3, 3), at(1, 1), "square", true))).toEqual(expected);
  });

  it("keeps only the outline for an unfilled square", () => {
    const outline = sorted(computeShapeCells(grid, at(1, 1), at(3, 3), "square", false));
    expect(outline).toEqual([at(1, 1), at(2, 1), at(3, 1), at(1, 2), at(3, 2), at(1, 3), at(2, 3), at(3, 3)]);
  });

  it("treats cells on the grid edge as part of the outline", () => {
    const outline = sorted(computeShapeCells({ width: 2, height: 2 }, 0, 3, "square", false));
    expect(outline).toEqual([0, 1, 2, 3]);
  });

  it("rasterizes a circle inside its bounding box", () => {
    const circle = sorted(computeShapeCells(grid, at(0, 0), at(4, 4), "circle", true));
    expect(circle).not.toContain(at(0, 0));
    expect(circle).not.toContain(at(4, 4));
    expect(circle).toContain(at(2, 2));
    expect(circle).toContain(at(0, 2));
    expect(circle).toContain(at(2, 0));
  });

  it("points the triangle apex at the row the drag started on", () => {
    const topDown = computeShapeCells(grid, at(0, 0), at(4, 2), "triangle", true);
    expect(sorted(topDown)).toEqual([
      at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0),
      at(1, 1), at(2, 1), at(3, 1),
      at(2, 2),
    ]);

    const bottomUp = computeShapeCells(grid, at(0, 2), at(4, 0), "triangle", true);
    expect(sorted(bottomUp)).toEqual([
      at(2, 0),
      at(1, 1), at(2, 1), at(3, 1),
      at(0, 2), at(1, 2), at(2, 2), at(3, 2), at(4, 2),
    ]);
  });

  it("clamps shapes whose end index lies beyond the grid", () => {
    const cells = computeShapeCells(grid, at(3, 3), grid.width * grid.height + 10, "square", true);
    for (const index of cells) {
      expect(index).toBeLessThan(grid.width * grid.height);
    }
    expect(cells).toContain(at(3, 3));
  });
});

describe("traceWorldSegment", () => {
  it("returns the start cell for a zero-length segment", () => {
    expect(traceWorldSegment(grid, { x: 1.5, y: 1.5 }, { x: 1.5, y: 1.5 })).toEqual([at(1, 1)]);
  });

  it("produces a gap-free run of distinct cells along a fast stroke", () => {
    const cells = traceWorldSegment(grid, { x: 0.5, y: 0.5 }, { x: 4.5, y: 0.5 });
    expect(cells).toEqual([at(0, 0), at(1, 0), at(2, 0), at(3, 0), at(4, 0)]);
  });

  it("bridges diagonal samples so the stroke stays connected", () => {
    const cells = traceWorldSegment(grid, { x: 0.5, y: 0.5 }, { x: 4.5, y: 4.5 });
    expect(cells[0]).toBe(at(0, 0));
    expect(cells[cells.length - 1]).toBe(at(4, 4));
    expect(new Set(cells).size).toBe(cells.length);
    for (let index = 1; index < cells.length; index += 1) {
      const prevX = cells[index - 1] % grid.width;
      const prevY = Math.floor(cells[index - 1] / grid.width);
      const x = cells[index] % grid.width;
      const y = Math.floor(cells[index] / grid.width);
      expect(Math.max(Math.abs(x - prevX), Math.abs(y - prevY))).toBe(1);
    }
  });

  it("skips samples that fall outside the grid", () => {
    const cells = traceWorldSegment(grid, { x: -2.5, y: 0.5 }, { x: 1.5, y: 0.5 });
    expect(cells).toEqual([at(0, 0), at(1, 0)]);
    expect(traceWorldSegment(grid, { x: -3, y: -3 }, { x: -1, y: -1 })).toEqual([]);
  });

  it("caps the number of samples for absurdly long or non-finite segments", () => {
    const huge = { width: 10, height: 10 };
    const cells = traceWorldSegment(huge, { x: 0.5, y: 0.5 }, { x: 9.5, y: 0.5 + MAX_SEGMENT_STEPS * 10 });
    expect(cells.length).toBeGreaterThan(0);
    expect(traceWorldSegment(huge, { x: 0.5, y: 0.5 }, { x: Infinity, y: 0.5 })).toEqual([]);
  });
});

describe("collectFillMask", () => {
  const toBuffer = (values: PixelValue[], width: number, height: number): PixelBuffer => {
    const buffer = createBuffer(width, height);
    values.forEach((value, i) => {
      buffer.data[i] = value === null ? 0 : packColor(value);
    });
    return buffer;
  };
  const setCells = (result: { mask: Uint8Array } | null) =>
    sorted(Array.from(result!.mask.keys()).filter((i) => result!.mask[i] === 1));

  const pixels: PixelValue[] = [
    "#aa0000", "#aa0000", null, "#bb0000", "#bb0000",
    "#aa0000", null, null, "#bb0000", null,
    null, null, "#cc0000", null, null,
    "#bb0000", null, null, null, "#aa0000",
    "#bb0000", "#bb0000", null, "#aa0000", "#aa0000",
  ];
  const buffer = toBuffer(pixels, 5, 5);

  it("matches a four-connected region and reports its bounds", () => {
    const wall = createBuffer(5, 5);
    for (let i = 0; i < 5; i += 1) wall.data[at(i, 4 - i)] = packColor("#ff0000");
    const result = collectFillMask(wall, at(0, 0))!;
    const expected: number[] = [];
    for (let y = 0; y < 5; y += 1) for (let x = 0; x < 5; x += 1) if (x + y < 4) expected.push(at(x, y));
    expect(setCells(result)).toEqual(expected);
    expect(expected).toHaveLength(10);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it("collects the region sharing the start cell's value", () => {
    expect(setCells(collectFillMask(buffer, at(0, 0)))).toEqual([at(0, 0), at(1, 0), at(0, 1)]);
    expect(setCells(collectFillMask(buffer, at(4, 4)))).toEqual([at(4, 3), at(3, 4), at(4, 4)]);
  });

  it("does not leak across diagonals or into other colors", () => {
    const result = collectFillMask(buffer, at(3, 0))!;
    expect(setCells(result)).toEqual([at(3, 0), at(4, 0), at(3, 1)]);
    expect(result.mask[at(4, 3)]).toBe(0);
  });

  it("fills the connected empty region without crossing painted cells", () => {
    const empty = setCells(collectFillMask(buffer, at(2, 0)));
    expect(empty).toContain(at(2, 0));
    expect(empty).toContain(at(1, 1));
    expect(empty).toContain(at(3, 3));
    expect(empty).not.toContain(at(2, 2));
    expect(empty).not.toContain(at(0, 0));
  });

  it("returns just the start cell when it is isolated", () => {
    const result = collectFillMask(buffer, at(2, 2))!;
    expect(setCells(result)).toEqual([at(2, 2)]);
    expect(result.bounds).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  });

  it("returns every cell of a uniformly filled grid", () => {
    const solid = toBuffer(new Array(9).fill("#ffffff"), 3, 3);
    const result = collectFillMask(solid, 4)!;
    expect(setCells(result)).toHaveLength(9);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it("fills winding regions that need multiple scanline passes", () => {
    // a U shape: left and right columns joined along the bottom
    const u = toBuffer(
      [
        null, "#111111", null,
        null, "#111111", null,
        null, null, null,
      ],
      3,
      3,
    );
    expect(setCells(collectFillMask(u, 0)).length).toBe(7);
  });

  it("fills transparent paint separately from empty cells", () => {
    const row = createBuffer(5, 1);
    row.data.fill(TRANSPARENT_PIXEL, 0, 3);
    const result = collectFillMask(row, 0)!;
    expect(setCells(result)).toEqual([0, 1, 2]);
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 3, height: 1 });
  });

  it("returns null for an out-of-range start", () => {
    expect(collectFillMask(createBuffer(3, 3), -1)).toBeNull();
    expect(collectFillMask(createBuffer(3, 3), 9)).toBeNull();
  });

  it("does not mutate the buffer", () => {
    const before = Array.from(buffer.data);
    collectFillMask(buffer, at(0, 0));
    expect(Array.from(buffer.data)).toEqual(before);
  });
});

describe("mask helpers", () => {
  const g = { width: 6, height: 6 };

  it("stampCells sets cells and grows the bounds", () => {
    const mask = createMask(g);
    expect(mask).toHaveLength(36);
    const first = stampCells(mask, g, [7, 8], null);
    expect(first).toEqual({ x: 1, y: 1, width: 2, height: 1 });
    const second = stampCells(mask, g, [28], first);
    expect(second).toEqual({ x: 1, y: 1, width: 4, height: 4 });
    expect(mask[7]).toBe(1);
    expect(mask[28]).toBe(1);
    expect(mask[0]).toBe(0);
  });

  it("stampCells tolerates an empty list", () => {
    const mask = createMask(g);
    expect(stampCells(mask, g, [], null)).toBeNull();
    const bounds = { x: 1, y: 1, width: 1, height: 1 };
    expect(stampCells(mask, g, [], bounds)).toBe(bounds);
  });

  it("clearMaskRect clears only cells inside the rect", () => {
    const mask = createMask(g);
    stampCells(mask, g, [0, 7, 8, 35], null);
    clearMaskRect(mask, g, { x: 1, y: 1, width: 2, height: 1 });
    expect(mask[7]).toBe(0);
    expect(mask[8]).toBe(0);
    expect(mask[0]).toBe(1);
    expect(mask[35]).toBe(1);
  });

  it("brushBounds clips the brush square to the grid", () => {
    expect(brushBounds({ width: 8, height: 8 }, 0, 4)).toEqual({ x: 0, y: 0, width: 3, height: 3 });
    expect(brushBounds({ width: 8, height: 8 }, 3 * 8 + 3, 3)).toEqual({ x: 2, y: 2, width: 3, height: 3 });
    expect(brushBounds({ width: 8, height: 8 }, 7 * 8 + 7, 4)).toEqual({ x: 6, y: 6, width: 2, height: 2 });
  });
});

describe("scratch masks", () => {
  it("reuses one mask, clearing only the previous stamp, and reallocates for a new grid", () => {
    const grid = { width: 4, height: 4 };
    const first = clearScratchMask(null, grid);
    expect(scratchPreview(first)).toBeNull();
    stampScratch(first, grid, [5, 6]);
    expect(scratchPreview(first)).toEqual({ mask: first.mask, bounds: { x: 1, y: 1, width: 2, height: 1 } });

    const second = clearScratchMask(first, grid);
    expect(second.mask).toBe(first.mask);
    expect(Array.from(second.mask).every((value) => value === 0)).toBe(true);
    stampScratch(second, grid, [15]);
    expect(scratchPreview(second)?.bounds).toEqual({ x: 3, y: 3, width: 1, height: 1 });

    // Same cell count, different layout: a fresh mask, so stale cells never leak.
    const transposed = clearScratchMask(second, { width: 2, height: 8 });
    expect(transposed.mask).not.toBe(second.mask);
    expect(transposed.width).toBe(2);
  });
});
