import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import { createBuffer, type PixelBuffer } from "../pixel-buffer";
import type { Layer } from "../PixelPencilTypes";
import { createLayerId, useLayerOperations } from "./useLayerOperations";

const WIDTH = 2;
const HEIGHT = 3;

const makeLayer = (id: string, name = id): Layer => ({
  id,
  name,
  pixels: createBuffer(WIDTH, HEIGHT),
  visible: true,
});

function setup(initialLayers: Layer[] = [makeLayer("a", "Layer 1")], initialActive = "a") {
  const layersRef = { current: initialLayers };
  /** What each structure change's `apply` handed to history. */
  const handedOver: (Map<string, PixelBuffer> | null)[] = [];
  const recordStructureChange = vi.fn((apply: () => Map<string, PixelBuffer> | void) => {
    handedOver.push(apply() ?? null);
  });
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
      gridWidth: WIDTH,
      gridHeight: HEIGHT,
      layersRef,
      setLayers,
      activeLayerId,
      setActiveLayerId,
      setPathPreview,
      setHoverIndexIfChanged,
      recordStructureChange,
    });
    return { api, layers, activeLayerId };
  });
  const ids = () => hook.result.current.layers.map((layer) => layer.id);
  return { hook, ids, recordStructureChange, handedOver, setPathPreview, setHoverIndexIfChanged };
}

describe("createLayerId", () => {
  it("produces distinct ids", () => {
    expect(createLayerId()).not.toBe(createLayerId());
    expect(createLayerId()).toMatch(/^layer-/);
  });
});

describe("useLayerOperations", () => {
  it("creates an empty visible layer on top with the next name and activates it", () => {
    const { hook, recordStructureChange, handedOver, setPathPreview, setHoverIndexIfChanged } = setup();
    act(() => hook.result.current.api.createLayer());
    const layers = hook.result.current.layers;
    expect(layers).toHaveLength(2);
    expect(layers[1].name).toBe("Layer 2");
    expect(layers[1].visible).toBe(true);
    expect(layers[1].pixels).toEqual(createBuffer(WIDTH, HEIGHT));
    expect(layers[1].pixels).not.toBe(layers[0].pixels);
    expect(hook.result.current.activeLayerId).toBe(layers[1].id);
    expect(recordStructureChange).toHaveBeenCalledTimes(1);
    expect(handedOver).toEqual([null]);
    expect(setPathPreview).toHaveBeenCalledWith(null);
    expect(setHoverIndexIfChanged).toHaveBeenCalledWith(null);
  });

  it("deletes a layer and moves the active layer to the topmost remaining one when needed", () => {
    const { hook, ids, recordStructureChange } = setup([makeLayer("a"), makeLayer("b"), makeLayer("c")], "b");
    act(() => hook.result.current.api.deleteLayer("b"));
    expect(ids()).toEqual(["a", "c"]);
    expect(hook.result.current.activeLayerId).toBe("c");

    act(() => hook.result.current.api.deleteLayer("c"));
    expect(ids()).toEqual(["a"]);
    expect(hook.result.current.activeLayerId).toBe("a");
    expect(recordStructureChange).toHaveBeenCalledTimes(2);
  });

  it("deleting a layer hands its buffer to history", () => {
    const layers = [makeLayer("a"), makeLayer("b")];
    layers[1].pixels.data[4] = 7;
    const removed = layers[1].pixels;
    const { hook, handedOver } = setup(layers, "a");
    act(() => hook.result.current.api.deleteLayer("b"));
    expect(handedOver).toHaveLength(1);
    expect([...(handedOver[0]?.keys() ?? [])]).toEqual(["b"]);
    expect(handedOver[0]?.get("b")).toBe(removed);
    expect(handedOver[0]?.get("b")?.data[4]).toBe(7);
  });

  it("keeps the active layer when deleting a different one", () => {
    const { hook, ids } = setup([makeLayer("a"), makeLayer("b")], "a");
    act(() => hook.result.current.api.deleteLayer("b"));
    expect(ids()).toEqual(["a"]);
    expect(hook.result.current.activeLayerId).toBe("a");
  });

  it("refuses to delete the last layer or an unknown layer", () => {
    const { hook, ids, recordStructureChange } = setup();
    act(() => hook.result.current.api.deleteLayer("a"));
    act(() => hook.result.current.api.deleteLayer("missing"));
    expect(ids()).toEqual(["a"]);
    expect(recordStructureChange).not.toHaveBeenCalled();
  });

  it("renames with a trimmed name as one structure change that keeps the layer's pixels", () => {
    const { hook, recordStructureChange, handedOver } = setup();
    const pixels = hook.result.current.layers[0].pixels;
    act(() => hook.result.current.api.renameLayer("a", "  Sky  "));
    expect(hook.result.current.layers[0].name).toBe("Sky");
    expect(hook.result.current.layers[0].pixels).toBe(pixels);
    expect(recordStructureChange).toHaveBeenCalledTimes(1);
    expect(handedOver).toEqual([null]);

    act(() => hook.result.current.api.renameLayer("a", "Sky"));
    act(() => hook.result.current.api.renameLayer("a", "   "));
    act(() => hook.result.current.api.renameLayer("missing", "Other"));
    expect(recordStructureChange).toHaveBeenCalledTimes(1);
    expect(hook.result.current.layers[0].name).toBe("Sky");
  });

  it("toggles visibility of a known layer only", () => {
    const { hook, recordStructureChange } = setup();
    act(() => hook.result.current.api.toggleLayerVisibility("a"));
    expect(hook.result.current.layers[0].visible).toBe(false);
    act(() => hook.result.current.api.toggleLayerVisibility("a"));
    expect(hook.result.current.layers[0].visible).toBe(true);
    act(() => hook.result.current.api.toggleLayerVisibility("missing"));
    expect(recordStructureChange).toHaveBeenCalledTimes(2);
  });

  it("reorders layers within bounds and ignores no-op or invalid moves", () => {
    const { hook, ids, recordStructureChange } = setup([makeLayer("a"), makeLayer("b"), makeLayer("c")]);
    act(() => hook.result.current.api.reorderLayers(0, 2));
    expect(ids()).toEqual(["b", "c", "a"]);
    act(() => hook.result.current.api.reorderLayers(2, 0));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(recordStructureChange).toHaveBeenCalledTimes(2);

    act(() => hook.result.current.api.reorderLayers(1, 1));
    act(() => hook.result.current.api.reorderLayers(-1, 0));
    act(() => hook.result.current.api.reorderLayers(0, 3));
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(recordStructureChange).toHaveBeenCalledTimes(2);
  });

  it("selects a known layer without recording history", () => {
    const { hook, recordStructureChange, setHoverIndexIfChanged } = setup([makeLayer("a"), makeLayer("b")]);
    act(() => hook.result.current.api.selectLayer("b"));
    expect(hook.result.current.activeLayerId).toBe("b");
    expect(setHoverIndexIfChanged).toHaveBeenCalledWith(null);

    act(() => hook.result.current.api.selectLayer("b"));
    act(() => hook.result.current.api.selectLayer("missing"));
    expect(hook.result.current.activeLayerId).toBe("b");
    expect(setHoverIndexIfChanged).toHaveBeenCalledTimes(1);
    expect(recordStructureChange).not.toHaveBeenCalled();
  });
});
