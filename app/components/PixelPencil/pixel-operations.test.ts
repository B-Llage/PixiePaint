import { describe, expect, it } from "vitest";

import { createBuffer, EMPTY_PIXEL, TRANSPARENT_PIXEL } from "./pixel-buffer";
import {
  areSelectionsEqual,
  cloneSelection,
  generateLayerName,
  hasSelectionPixels,
} from "./pixel-operations";
import type { Layer, SelectionState } from "./PixelPencilTypes";

const makeLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: "layer-1",
  name: "Layer 1",
  pixels: createBuffer(2, 2),
  visible: true,
  ...overrides,
});

const makeSelection = (overrides: Partial<SelectionState> = {}): SelectionState => ({
  rect: { x: 1, y: 2, width: 2, height: 2 },
  offset: { dx: 0, dy: 0 },
  data: new Uint32Array([0xff0000ff, EMPTY_PIXEL, TRANSPARENT_PIXEL, 0x00ff00ff]),
  isFloating: false,
  ...overrides,
});

describe("cloneSelection", () => {
  it("returns null for null", () => {
    expect(cloneSelection(null)).toBeNull();
  });

  it("deep-copies rect, offset and data", () => {
    const source = makeSelection();
    const clone = cloneSelection(source)!;

    expect(clone).toEqual(source);
    clone.data[0] = 0x12345678;
    clone.rect.x = 9;
    clone.offset.dx = 5;

    expect(source.data[0]).toBe(0xff0000ff);
    expect(source.rect.x).toBe(1);
    expect(source.offset.dx).toBe(0);
  });
});

describe("areSelectionsEqual", () => {
  it("treats identical references and two nulls as equal", () => {
    const selection = makeSelection();
    expect(areSelectionsEqual(selection, selection)).toBe(true);
    expect(areSelectionsEqual(null, null)).toBe(true);
    expect(areSelectionsEqual(selection, null)).toBe(false);
  });

  it("is equal for deep copies", () => {
    expect(areSelectionsEqual(makeSelection(), makeSelection())).toBe(true);
  });

  it("detects a one-cell difference in data", () => {
    const other = makeSelection();
    other.data[3] = 0x00ff01ff;
    expect(areSelectionsEqual(makeSelection(), other)).toBe(false);
  });

  it("detects rect, offset, and floating differences", () => {
    expect(areSelectionsEqual(makeSelection(), makeSelection({ rect: { x: 0, y: 2, width: 2, height: 2 } }))).toBe(false);
    expect(areSelectionsEqual(makeSelection(), makeSelection({ offset: { dx: 1, dy: 0 } }))).toBe(false);
    expect(areSelectionsEqual(makeSelection(), makeSelection({ isFloating: true }))).toBe(false);
  });

  it("detects differing data lengths", () => {
    expect(areSelectionsEqual(makeSelection(), makeSelection({ data: new Uint32Array(2) }))).toBe(false);
  });
});

describe("hasSelectionPixels", () => {
  it("is false for null and all-empty data", () => {
    expect(hasSelectionPixels(null)).toBe(false);
    expect(hasSelectionPixels(makeSelection({ data: new Uint32Array(4) }))).toBe(false);
  });

  it("is true when one cell is transparent or painted", () => {
    const transparent = new Uint32Array(4);
    transparent[2] = TRANSPARENT_PIXEL;
    expect(hasSelectionPixels(makeSelection({ data: transparent }))).toBe(true);
    expect(hasSelectionPixels(makeSelection())).toBe(true);
  });
});

describe("generateLayerName", () => {
  it("starts one past the layer count", () => {
    expect(generateLayerName([])).toBe("Layer 1");
    expect(generateLayerName([makeLayer()])).toBe("Layer 2");
  });

  it("skips names that already exist", () => {
    const layers = [makeLayer({ name: "Layer 2" }), makeLayer({ id: "b", name: "Layer 3" })];
    expect(generateLayerName(layers)).toBe("Layer 4");
    expect(generateLayerName([makeLayer({ name: "Background" })])).toBe("Layer 2");
  });
});
