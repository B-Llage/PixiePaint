import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import type { Layer, PixelValue } from "../PixelPencilTypes";
import { createLayerId, useLayerOperations } from "./useLayerOperations";

const TOTAL = 4;

const makeLayer = (id: string, name = id): Layer => ({
  id,
  name,
  pixels: new Array<PixelValue>(TOTAL).fill(null),
  visible: true,
});

function setup(initialLayers: Layer[] = [makeLayer("a", "Layer 1")], initialActive = "a") {
  const layersRef = { current: initialLayers };
  const recordSnapshot = vi.fn();
  const commitSnapshot = vi.fn();
  const setPathPreview = vi.fn();
  const setHoverIndexIfChanged = vi.fn();
  const hook = renderHook(() => {
    const [activeLayerId, setActiveLayerId] = useState(initialActive);
    const [layers, setLayersState] = useState(layersRef.current);
    const setLayers = (next: SetStateAction<Layer[]>) => {
      layersRef.current = typeof next === "function" ? next(layersRef.current) : next;
      setLayersState(layersRef.current);
      return layersRef.current;
    };
    const api = useLayerOperations({
      totalCells: TOTAL,
      layersRef,
      setLayers,
      activeLayerId,
      setActiveLayerId,
      setPathPreview,
      setHoverIndexIfChanged,
      recordSnapshot,
      commitSnapshot,
    });
    return { api, layers, activeLayerId };
  });
  const ids = () => hook.result.current.layers.map((layer) => layer.id);
  return { hook, ids, recordSnapshot, commitSnapshot, setPathPreview, setHoverIndexIfChanged };
}

describe("createLayerId", () => {
  it("produces distinct ids", () => {
    expect(createLayerId()).not.toBe(createLayerId());
    expect(createLayerId()).toMatch(/^layer-/);
  });
});

describe("useLayerOperations", () => {
  it("creates an empty visible layer on top with the next name and activates it", () => {
    const { hook, commitSnapshot, setPathPreview, setHoverIndexIfChanged } = setup();
    act(() => hook.result.current.api.createLayer());
    const layers = hook.result.current.layers;
    expect(layers).toHaveLength(2);
    expect(layers[1].name).toBe("Layer 2");
    expect(layers[1].visible).toBe(true);
    expect(layers[1].pixels).toEqual([null, null, null, null]);
    expect(hook.result.current.activeLayerId).toBe(layers[1].id);
    expect(commitSnapshot).toHaveBeenCalledTimes(1);
    expect(setPathPreview).toHaveBeenCalledWith(null);
    expect(setHoverIndexIfChanged).toHaveBeenCalledWith(null);
  });

  it("deletes a layer and moves the active layer to the topmost remaining one when needed", () => {
    const { hook, ids, commitSnapshot } = setup([makeLayer("a"), makeLayer("b"), makeLayer("c")], "b");
    act(() => hook.result.current.api.deleteLayer("b"));
    expect(ids()).toEqual(["a", "c"]);
    expect(hook.result.current.activeLayerId).toBe("c");

    act(() => hook.result.current.api.deleteLayer("c"));
    expect(ids()).toEqual(["a"]);
    expect(hook.result.current.activeLayerId).toBe("a");
    expect(commitSnapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps the active layer when deleting a different one", () => {
    const { hook, ids } = setup([makeLayer("a"), makeLayer("b")], "a");
    act(() => hook.result.current.api.deleteLayer("b"));
    expect(ids()).toEqual(["a"]);
    expect(hook.result.current.activeLayerId).toBe("a");
  });

  it("refuses to delete the last layer or an unknown layer", () => {
    const { hook, ids, commitSnapshot } = setup();
    act(() => hook.result.current.api.deleteLayer("a"));
    act(() => hook.result.current.api.deleteLayer("missing"));
    expect(ids()).toEqual(["a"]);
    expect(commitSnapshot).not.toHaveBeenCalled();
  });

  it("renames with a trimmed name and records history without ending an action", () => {
    const { hook, recordSnapshot, commitSnapshot } = setup();
    act(() => hook.result.current.api.renameLayer("a", "  Sky  "));
    expect(hook.result.current.layers[0].name).toBe("Sky");
    expect(recordSnapshot).toHaveBeenCalledTimes(1);
    expect(commitSnapshot).not.toHaveBeenCalled();

    act(() => hook.result.current.api.renameLayer("a", "Sky"));
    act(() => hook.result.current.api.renameLayer("a", "   "));
    act(() => hook.result.current.api.renameLayer("missing", "Other"));
    expect(recordSnapshot).toHaveBeenCalledTimes(1);
    expect(hook.result.current.layers[0].name).toBe("Sky");
  });

  it("toggles visibility of a known layer only", () => {
    const { hook, commitSnapshot } = setup();
    act(() => hook.result.current.api.toggleLayerVisibility("a"));
    expect(hook.result.current.layers[0].visible).toBe(false);
    act(() => hook.result.current.api.toggleLayerVisibility("a"));
    expect(hook.result.current.layers[0].visible).toBe(true);
    act(() => hook.result.current.api.toggleLayerVisibility("missing"));
    expect(commitSnapshot).toHaveBeenCalledTimes(2);
  });

  it("reorders layers within bounds and ignores no-op or invalid moves", () => {
    const { hook, ids, commitSnapshot } = setup([makeLayer("a"), makeLayer("b"), makeLayer("c")]);
    act(() => hook.result.current.api.reorderLayers(0, 2));
    expect(ids()).toEqual(["b", "c", "a"]);
    act(() => hook.result.current.api.reorderLayers(2, 0));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(commitSnapshot).toHaveBeenCalledTimes(2);

    act(() => hook.result.current.api.reorderLayers(1, 1));
    act(() => hook.result.current.api.reorderLayers(-1, 0));
    act(() => hook.result.current.api.reorderLayers(0, 3));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(commitSnapshot).toHaveBeenCalledTimes(2);
  });

  it("selects a known layer without recording history", () => {
    const { hook, recordSnapshot, commitSnapshot, setHoverIndexIfChanged } = setup([makeLayer("a"), makeLayer("b")]);
    act(() => hook.result.current.api.selectLayer("b"));
    expect(hook.result.current.activeLayerId).toBe("b");
    expect(setHoverIndexIfChanged).toHaveBeenCalledWith(null);

    act(() => hook.result.current.api.selectLayer("b"));
    act(() => hook.result.current.api.selectLayer("missing"));
    expect(hook.result.current.activeLayerId).toBe("b");
    expect(setHoverIndexIfChanged).toHaveBeenCalledTimes(1);
    expect(recordSnapshot).not.toHaveBeenCalled();
    expect(commitSnapshot).not.toHaveBeenCalled();
  });
});
