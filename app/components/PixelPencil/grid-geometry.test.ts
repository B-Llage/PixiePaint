import { describe, expect, it } from "vitest";

import {
  collectFillRegion,
  computeBrushIndices,
  computeLineIndices,
  computeShapeCells,
  MAX_SEGMENT_STEPS,
  traceWorldSegment,
} from "./grid-geometry";
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

describe("collectFillRegion", () => {
  const pixels: PixelValue[] = [
    "#a", "#a", null, "#b", "#b",
    "#a", null, null, "#b", null,
    null, null, "#c", null, null,
    "#b", null, null, null, "#a",
    "#b", "#b", null, "#a", "#a",
  ];

  it("collects the four-connected region sharing the start cell's value", () => {
    expect(sorted(collectFillRegion(pixels, at(0, 0), 5, 5))).toEqual([at(0, 0), at(1, 0), at(0, 1)]);
    expect(sorted(collectFillRegion(pixels, at(4, 4), 5, 5))).toEqual([at(4, 3), at(3, 4), at(4, 4)]);
  });

  it("does not leak across diagonals or into other colors", () => {
    const region = collectFillRegion(pixels, at(3, 0), 5, 5);
    expect(sorted(region)).toEqual([at(3, 0), at(4, 0), at(3, 1)]);
    expect(region.has(at(4, 3))).toBe(false);
  });

  it("fills the connected empty region without crossing painted cells", () => {
    const empty = sorted(collectFillRegion(pixels, at(2, 0), 5, 5));
    expect(empty).toContain(at(2, 0));
    expect(empty).toContain(at(1, 1));
    expect(empty).toContain(at(3, 3));
    expect(empty).not.toContain(at(2, 2));
    expect(empty).not.toContain(at(0, 0));
  });

  it("returns just the start cell when it is isolated", () => {
    expect(Array.from(collectFillRegion(pixels, at(2, 2), 5, 5))).toEqual([at(2, 2)]);
  });

  it("returns every cell of a uniformly filled grid", () => {
    const solid: PixelValue[] = new Array(9).fill("#fff");
    expect(collectFillRegion(solid, 4, 3, 3).size).toBe(9);
  });

  it("does not mutate the source pixels", () => {
    const copy = [...pixels];
    collectFillRegion(pixels, at(0, 0), 5, 5);
    expect(pixels).toEqual(copy);
  });
});
