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

/** jsdom has no ImageData without the canvas package. */
class ImageDataStub {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

type Draw = { name: string; args: unknown[]; alpha: number; smoothing: boolean; quality: string; canvas: HTMLCanvasElement };

function setup(initial: Props) {
  vi.stubGlobal("ImageData", ImageDataStub);
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    delete frames[id - 1];
  });
  const pendingFrames = () => frames.filter(Boolean).length;
  const draws: Draw[] = [];
  const contexts = new Map<HTMLCanvasElement, unknown>();
  let toDataURLCalls = 0;
  HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
    if (contexts.has(this)) return contexts.get(this);
    const record = (name: string) =>
      vi.fn((...args: unknown[]) => {
        draws.push({ name, args, alpha: context.globalAlpha, smoothing: context.imageSmoothingEnabled, quality: context.imageSmoothingQuality, canvas: this });
      });
    const context = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "low",
      globalCompositeOperation: "source-over",
      putImageData: record("putImageData"),
      drawImage: record("drawImage"),
    };
    contexts.set(this, context);
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
  const named = (name: string) => draws.filter((draw) => draw.name === name);
  return { ...hook, pendingFrames, runFrames, draws, named };
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
    const { result, runFrames } = setup({
      layers: [layer("a", ["#ff0000", null, null, null]), layer("b")],
      width: 2,
      height: 2,
    });
    expect(result.current).toEqual({});

    runFrames();
    expect(Object.keys(result.current)).toEqual(["a", "b"]);
    expect(result.current.a).toMatch(/^data:image\/png/);
    expect(result.current.a).not.toBe(result.current.b);
  });

  it("rasterizes each layer with one putImageData and one scaled drawImage", () => {
    const layers = [layer("a", ["#ff0000", null, null, null]), { ...layer("b"), visible: false }];
    const { runFrames, named } = setup({ layers, width: 2, height: 2 });
    runFrames();

    const uploads = named("putImageData");
    expect(uploads).toHaveLength(2);
    // The upload shares the layer buffer's memory and lands in a grid-sized offscreen canvas.
    const first = uploads[0].args[0] as ImageDataStub;
    expect(first.data.buffer).toBe(layers[0].pixels.data.buffer);
    expect([first.width, first.height]).toEqual([2, 2]);
    expect(uploads[0].canvas.width).toBe(2);
    expect(uploads[0].canvas.height).toBe(2);

    const blits = named("drawImage");
    expect(blits).toHaveLength(2);
    // 2x2 grid scales by 32 into a 64x64 thumbnail with smoothing off; hidden layers draw at 0.4.
    expect(blits[0].args.slice(1)).toEqual([0, 0, 2, 2, 0, 0, 64, 64]);
    expect(blits.map((blit) => blit.smoothing)).toEqual([false, false]);
    expect(blits.map((blit) => blit.alpha)).toEqual([1, 0.4]);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledTimes(2);
  });

  it("shrinks large grids by smoothed halvings and reuses the offscreen canvases", () => {
    const painted = createBuffer(256, 256);
    painted.data[0] = toPackedValue("#ff0000");
    const big = { id: "a", name: "a", pixels: painted, visible: false };
    const { rerender, runFrames, named } = setup({ layers: [big], width: 256, height: 256 });
    runFrames();

    // 256 -> 128 is within 2x of the 64px thumbnail, so one halving, then the final draw.
    const blits = named("drawImage");
    expect(blits).toHaveLength(2);
    const [halving, final] = blits;
    expect(halving.args.slice(1)).toEqual([0, 0, 256, 256, 0, 0, 128, 128]);
    expect(halving.canvas).not.toBe(final.canvas);
    expect(halving.smoothing).toBe(true);
    expect(halving.alpha).toBe(1);
    expect(final.args.slice(1)).toEqual([0, 0, 128, 128, 0, 0, 64, 64]);
    expect(final.args[0]).toBe(halving.canvas);
    expect(final.smoothing).toBe(true);
    expect([halving.quality, final.quality]).toEqual(["high", "high"]);
    // Hidden-layer alpha applies to the final draw only.
    expect(final.alpha).toBe(0.4);

    rerender({ layers: [big], width: 256, height: 256, previewVersion: 1 });
    runFrames();
    const uploads = named("putImageData");
    expect(uploads).toHaveLength(2);
    expect(uploads[1].canvas).toBe(uploads[0].canvas);
    expect(named("drawImage")[2].canvas).toBe(halving.canvas);
  });

  it("halves repeatedly for very large grids with high-quality smoothing", () => {
    const big = { id: "a", name: "a", pixels: createBuffer(2048, 1024), visible: true };
    const { runFrames, named } = setup({ layers: [big], width: 2048, height: 1024 });
    runFrames();
    const sizes = named("drawImage").map((blit) => blit.args.slice(5));
    expect(sizes).toEqual([
      [0, 0, 1024, 512],
      [0, 0, 512, 256],
      [0, 0, 256, 128],
      [0, 0, 128, 64],
      [0, 0, 64, 32],
    ]);
  });

  it("keeps a sparse pixel visible when a large grid is shrunk", () => {
    const painted = createBuffer(256, 256);
    painted.data[0] = toPackedValue("#ff0000");
    const { runFrames, named } = setup({
      layers: [{ id: "a", name: "a", pixels: painted, visible: true }],
      width: 256,
      height: 256,
    });
    runFrames();
    // The upload carries the painted pixel and every later draw reads from it, smoothed rather than sampled.
    const upload = named("putImageData")[0].args[0] as ImageDataStub;
    expect(new Uint32Array(upload.data.buffer)[0]).toBe(painted.data[0]);
    expect(named("drawImage").every((blit) => blit.smoothing)).toBe(true);
  });

  it("does not re-render thumbnails until previewVersion changes", () => {
    const layers = [layer("a")];
    const { result, rerender, runFrames, pendingFrames, named } = setup({ layers, width: 2, height: 2 });
    runFrames();
    const before = result.current.a;
    expect(named("putImageData")).toHaveLength(1);

    // Edits that do not bump previewVersion (a stroke in progress) schedule nothing.
    layers[0].pixels.data[0] = toPackedValue("#00ff00");
    rerender({ layers, width: 2, height: 2, previewVersion: 0 });
    expect(pendingFrames()).toBe(0);
    expect(named("putImageData")).toHaveLength(1);

    rerender({ layers, width: 2, height: 2, previewVersion: 1 });
    runFrames();
    expect(named("putImageData")).toHaveLength(2);
    expect(result.current.a).not.toBe(before);
  });

  it("re-renders thumbnails from the edited buffer when the preview version bumps", () => {
    const layers = [layer("a")];
    const { result, rerender, runFrames, named } = setup({ layers, width: 2, height: 2, previewVersion: 0 });
    runFrames();
    const before = result.current.a;

    // Buffers are edited in place, so the layers array keeps its identity.
    layers[0].pixels.data[3] = toPackedValue("#00ff00");
    rerender({ layers, width: 2, height: 2, previewVersion: 1 });
    runFrames();
    const upload = named("putImageData").at(-1)!.args[0] as ImageDataStub;
    expect(upload.data.buffer).toBe(layers[0].pixels.data.buffer);
    expect(new Uint32Array(upload.data.buffer)[3]).toBe(layers[0].pixels.data[3]);
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
