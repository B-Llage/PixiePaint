import { describe, expect, it } from "vitest";

import { composeLayers, translatePixels } from "./pixel-operations";

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
