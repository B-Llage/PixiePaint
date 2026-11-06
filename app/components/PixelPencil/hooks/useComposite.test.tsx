import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Layer } from "../PixelPencilTypes";
import { createBuffer, packColor } from "../pixel-buffer";
import { useComposite } from "./useComposite";

const RED = packColor("#ff0000");

function setup(size = 4) {
  const bottom: Layer = { id: "a", name: "a", visible: true, pixels: createBuffer(size, size) };
  const layersRef = { current: [bottom] };
  const hook = renderHook((p: { width: number; height: number }) => useComposite({ layersRef, ...p }), {
    initialProps: { width: size, height: size },
  });
  return { bottom, layersRef, hook };
}

describe("useComposite", () => {
  it("recomposes only the given rect", () => {
    const { bottom, hook } = setup();
    bottom.pixels.data.fill(RED);
    act(() => hook.result.current.recompose({ x: 0, y: 0, width: 1, height: 1 }));
    expect(hook.result.current.compositeRef.current.data[0]).toBe(RED);
    expect(hook.result.current.compositeRef.current.data[1]).toBe(0);
  });

  it("recomposes everything on null", () => {
    const { bottom, hook } = setup();
    bottom.pixels.data.fill(RED);
    act(() => hook.result.current.recompose(null));
    expect(hook.result.current.compositeRef.current.data.every((v) => v === RED)).toBe(true);
  });

  it("rebuilds and fully recomposes when the size changes", () => {
    const { layersRef, hook } = setup(4);
    const bigger = createBuffer(8, 8);
    bigger.data.fill(RED);
    layersRef.current = [{ id: "a", name: "a", visible: true, pixels: bigger }];
    const previous = hook.result.current.composite;
    const versionBefore = hook.result.current.compositeVersion;
    hook.rerender({ width: 8, height: 8 });
    expect(hook.result.current.composite).not.toBe(previous);
    expect(hook.result.current.compositeVersion).toBe(versionBefore);
    expect(hook.result.current.composite.width).toBe(8);
    expect(hook.result.current.composite.height).toBe(8);
    const composite = hook.result.current.compositeRef.current;
    expect(composite.width).toBe(8);
    expect(composite.data.length).toBe(64);
    expect(composite.data.every((v) => v === RED)).toBe(true);
    expect(hook.result.current.dirtyRef.current).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  });

  it("bumps compositeVersion on each recompose", () => {
    const { hook } = setup();
    const before = hook.result.current.compositeVersion;
    act(() => hook.result.current.recompose({ x: 0, y: 0, width: 1, height: 1 }));
    act(() => hook.result.current.recompose(null));
    expect(hook.result.current.compositeVersion).toBe(before + 2);
  });

  it("accumulates the dirty rect until it is cleared", () => {
    const { hook } = setup();
    // The initial build leaves the full grid dirty until the renderer clears it.
    expect(hook.result.current.dirtyRef.current).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    hook.result.current.dirtyRef.current = null;
    act(() => hook.result.current.recompose({ x: 0, y: 0, width: 1, height: 1 }));
    act(() => hook.result.current.recompose({ x: 2, y: 3, width: 1, height: 1 }));
    expect(hook.result.current.dirtyRef.current).toEqual({ x: 0, y: 0, width: 3, height: 4 });
    hook.result.current.dirtyRef.current = null;
    act(() => hook.result.current.recompose(null));
    expect(hook.result.current.dirtyRef.current).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it("keeps recompose identity stable", () => {
    const { hook } = setup();
    const first = hook.result.current.recompose;
    act(() => first(null));
    expect(hook.result.current.recompose).toBe(first);
  });
});
