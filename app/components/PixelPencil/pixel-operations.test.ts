import { describe, expect, it } from "vitest";

import {
  areLayersEqual,
  arePixelsEqual,
  areSelectionsEqual,
  cloneLayer,
  cloneLayers,
  cloneSelection,
  composeLayers,
  generateLayerName,
  translatePixels,
} from "./pixel-operations";
import type { Layer, SelectionState } from "./PixelPencilTypes";

const makeLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: "layer-1",
  name: "Layer 1",
  pixels: ["#a", null, "transparent", "#b"],
  visible: true,
  ...overrides,
});

const makeSelection = (overrides: Partial<SelectionState> = {}): SelectionState => ({
  rect: { x: 1, y: 2, width: 3, height: 4 },
  offset: { dx: 0, dy: 0 },
  pixels: [
    { relX: 0, relY: 0, color: "#a" },
    { relX: 1, relY: 0, color: null },
  ],
  isFloating: false,
  ...overrides,
});

describe("composeLayers", () => {
  it("uses the topmost visible opaque pixel", () => {
    const bottom = { visible: true, pixels: ["#111111", "#222222", null] };
    const top = { visible: true, pixels: ["transparent", "#eeeeee", "#ffffff"] };

    expect(composeLayers([bottom, top], 3)).toEqual(["#111111", "#eeeeee", "#ffffff"]);
    expect(composeLayers([bottom, { ...top, visible: false }], 3)).toEqual([
      "#111111",
      "#222222",
      null,
    ]);
  });
});

describe("translatePixels", () => {
  it("moves pixels by whole cells and clips anything beyond the edge", () => {
    const source = ["#a", null, "#b", null, null, "#c"];

    expect(translatePixels(source, 3, 2, 1, 0)).toEqual([null, "#a", null, null, null, null]);
    expect(translatePixels(source, 3, 2, 0, -1)).toEqual([null, null, "#c", null, null, null]);
    expect(source).toEqual(["#a", null, "#b", null, null, "#c"]);
  });
});

describe("arePixelsEqual", () => {
  it("compares cell by cell and by length", () => {
    expect(arePixelsEqual(["#a", null], ["#a", null])).toBe(true);
    expect(arePixelsEqual(["#a", null], ["#a", "transparent"])).toBe(false);
    expect(arePixelsEqual(["#a"], ["#a", null])).toBe(false);
    expect(arePixelsEqual([], [])).toBe(true);
  });
});

describe("cloneLayer and cloneLayers", () => {
  it("produces an independent copy with the same contents", () => {
    const layer = makeLayer();
    const copy = cloneLayer(layer, 4);

    expect(copy).toEqual(layer);
    expect(copy).not.toBe(layer);
    expect(copy.pixels).not.toBe(layer.pixels);
    copy.pixels[0] = "#zzz";
    expect(layer.pixels[0]).toBe("#a");
  });

  it("pads with null when the target size is larger and truncates when smaller", () => {
    const layer = makeLayer();
    expect(cloneLayer(layer, 6).pixels).toEqual(["#a", null, "transparent", "#b", null, null]);
    expect(cloneLayer(layer, 2).pixels).toEqual(["#a", null]);
  });

  it("normalizes sparse holes to null", () => {
    const sparse = makeLayer({ pixels: new Array(3) as Layer["pixels"] });
    expect(cloneLayer(sparse, 3).pixels).toEqual([null, null, null]);
  });

  it("clones every layer in order", () => {
    const layers = [makeLayer(), makeLayer({ id: "layer-2", name: "Layer 2", visible: false })];
    const copies = cloneLayers(layers, 4);
    expect(copies).toEqual(layers);
    expect(copies[1]).not.toBe(layers[1]);
  });
});

describe("cloneSelection", () => {
  it("returns null for null", () => {
    expect(cloneSelection(null)).toBeNull();
  });

  it("deep copies the rect, offset, and pixels", () => {
    const selection = makeSelection({ isFloating: true, offset: { dx: 2, dy: -1 } });
    const copy = cloneSelection(selection);

    expect(copy).toEqual(selection);
    expect(copy).not.toBe(selection);
    expect(copy?.rect).not.toBe(selection.rect);
    expect(copy?.offset).not.toBe(selection.offset);
    expect(copy?.pixels[0]).not.toBe(selection.pixels[0]);
  });
});

describe("areSelectionsEqual", () => {
  it("treats two nulls as equal and null versus a selection as different", () => {
    expect(areSelectionsEqual(null, null)).toBe(true);
    expect(areSelectionsEqual(null, makeSelection())).toBe(false);
    expect(areSelectionsEqual(makeSelection(), null)).toBe(false);
  });

  it("compares structure rather than identity", () => {
    expect(areSelectionsEqual(makeSelection(), makeSelection())).toBe(true);
    expect(areSelectionsEqual(makeSelection(), makeSelection({ isFloating: true }))).toBe(false);
    expect(areSelectionsEqual(makeSelection(), makeSelection({ offset: { dx: 1, dy: 0 } }))).toBe(false);
    expect(
      areSelectionsEqual(makeSelection(), makeSelection({ rect: { x: 1, y: 2, width: 3, height: 5 } })),
    ).toBe(false);
    expect(
      areSelectionsEqual(
        makeSelection(),
        makeSelection({ pixels: [{ relX: 0, relY: 0, color: "#a" }, { relX: 1, relY: 0, color: "#b" }] }),
      ),
    ).toBe(false);
    expect(areSelectionsEqual(makeSelection(), makeSelection({ pixels: [] }))).toBe(false);
  });
});

describe("areLayersEqual", () => {
  it("requires matching ids, names, visibility, and pixels", () => {
    expect(areLayersEqual([makeLayer()], [makeLayer()])).toBe(true);
    expect(areLayersEqual([makeLayer()], [makeLayer({ id: "other" })])).toBe(false);
    expect(areLayersEqual([makeLayer()], [makeLayer({ name: "Renamed" })])).toBe(false);
    expect(areLayersEqual([makeLayer()], [makeLayer({ visible: false })])).toBe(false);
    expect(areLayersEqual([makeLayer()], [makeLayer({ pixels: ["#a", null, null, "#b"] })])).toBe(false);
    expect(areLayersEqual([makeLayer()], [])).toBe(false);
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
