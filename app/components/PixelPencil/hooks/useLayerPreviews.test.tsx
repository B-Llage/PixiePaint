import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBuffer, toPackedValue } from "../pixel-buffer";
import type { Layer, PixelValue } from "../PixelPencilTypes";
import { useLayerPreviews } from "./useLayerPreviews";

const layer = (id: string, values: PixelValue[] = [null, null, null, null]): Layer => {
  const pixels = createBuffer(2, 2);
  values.forEach((value, index) => {
    pixels.data[index] = toPackedValue(value);
  });
  return { id, name: id, pixels, visible: true };
};

type Props = { layers: Layer[]; width: number; height: number; previewVersion?: number };

function setup(initial: Props) {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    delete frames[id - 1];
  });
  const pendingFrames = () => frames.filter(Boolean).length;
  const fillRect = vi.fn();
  const fillStyles: string[] = [];
  let toDataURLCalls = 0;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => {
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn((...args: number[]) => {
        fillStyles.push(context.fillStyle);
        fillRect(...args);
      }),
      fillStyle: "",
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    };
    return context;
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => `data:image/png;base64,frame-${++toDataURLCalls}`);

  const runFrames = () =>
    act(() => {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame?.(0);
    });

  const hook = renderHook(
    (props: Props) => useLayerPreviews(props.layers, props.width, props.height, props.previewVersion ?? 0),
    { initialProps: initial },
  );
  return { ...hook, pendingFrames, runFrames, fillRect, fillStyles };
}

afterEach(() => vi.unstubAllGlobals());

describe("useLayerPreviews", () => {
  it("yields no previews and schedules no frame for an empty grid or no layers", () => {
    const empty = setup({ layers: [], width: 2, height: 2 });
    expect(empty.result.current).toEqual({});
    expect(empty.pendingFrames()).toBe(0);

    empty.rerender({ layers: [layer("a")], width: 0, height: 2 });
    expect(empty.result.current).toEqual({});
    expect(empty.pendingFrames()).toBe(0);
  });

  it("renders one thumbnail per layer on the next frame", () => {
    const { result, runFrames, fillRect } = setup({
      layers: [layer("a", ["#ff0000", null, null, null]), layer("b")],
      width: 2,
      height: 2,
    });
    expect(result.current).toEqual({});

    runFrames();
    expect(Object.keys(result.current)).toEqual(["a", "b"]);
    expect(result.current.a).toMatch(/^data:image\/png/);
    expect(result.current.a).not.toBe(result.current.b);
    // The red pixel is drawn at the top-left cell, scaled to the thumbnail.
    expect(fillRect).toHaveBeenCalledWith(0, 0, 32, 32);
  });

  it("re-renders thumbnails when the preview version bumps after an in-place edit", () => {
    const layers = [layer("a")];
    const { result, rerender, runFrames, fillStyles } = setup({ layers, width: 2, height: 2, previewVersion: 0 });
    runFrames();
    const before = result.current.a;
    expect(fillStyles).not.toContain("#00ff00");

    // Buffers are edited in place, so the layers array keeps its identity.
    layers[0].pixels.data[3] = toPackedValue("#00ff00");
    rerender({ layers, width: 2, height: 2, previewVersion: 1 });
    runFrames();
    expect(fillStyles).toContain("#00ff00");
    expect(result.current.a).not.toBe(before);
  });

  it("keeps existing thumbnails while regenerating and drops removed layers", () => {
    const { result, rerender, runFrames, pendingFrames } = setup({
      layers: [layer("a"), layer("b")],
      width: 2,
      height: 2,
    });
    runFrames();
    const previousA = result.current.a;

    rerender({ layers: [layer("a"), layer("c")], width: 2, height: 2 });
    expect(result.current).toEqual({ a: previousA });

    runFrames();
    expect(Object.keys(result.current)).toEqual(["a", "c"]);

    rerender({ layers: [], width: 2, height: 2 });
    expect(result.current).toEqual({});
    expect(pendingFrames()).toBe(0);
  });

  it("cancels a pending frame when the layers change again before it runs", () => {
    const { result, rerender, runFrames } = setup({ layers: [layer("a")], width: 2, height: 2 });
    rerender({ layers: [layer("a"), layer("b")], width: 2, height: 2 });
    runFrames();
    expect(Object.keys(result.current)).toEqual(["a", "b"]);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(2);
  });
});
