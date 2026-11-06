import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBuffer, packColor, TRANSPARENT_PIXEL } from "../pixel-buffer";
import { usePixelExport } from "./usePixelExport";

/** jsdom has no ImageData without the canvas package. */
class ImageDataStub {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

beforeEach(() => {
  vi.stubGlobal("ImageData", ImageDataStub);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Queues animation frames so the test decides when the preview is drawn. */
function stubFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  return () =>
    act(() => {
      for (const frame of frames.splice(0, frames.length)) frame(0);
    });
}

describe("usePixelExport", () => {
  it("exports through putImageData and a scaled drawImage", () => {
    const runFrames = stubFrames();
    const canvases: HTMLCanvasElement[] = [];
    const calls: { name: string; canvas: HTMLCanvasElement; args: unknown[]; smoothing: boolean }[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
      const context = {
        imageSmoothingEnabled: true,
        putImageData: (...args: unknown[]) =>
          calls.push({ name: "putImageData", canvas: this, args, smoothing: context.imageSmoothingEnabled }),
        drawImage: (...args: unknown[]) =>
          calls.push({ name: "drawImage", canvas: this, args, smoothing: context.imageSmoothingEnabled }),
      };
      return context as unknown as CanvasRenderingContext2D;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,preview");
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback) {
      canvases.push(this);
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const createObjectURL = vi.fn(() => "blob:pixel-art");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
    let downloadName = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    const composite = createBuffer(2, 1);
    composite.data[0] = packColor("#123456");
    composite.data[1] = TRANSPARENT_PIXEL;
    const compositeRef = { current: composite };
    const { result } = renderHook(() => usePixelExport({
      gridWidth: 2,
      gridHeight: 1,
      compositeRef,
      compositeVersion: 0,
    }));

    act(() => {
      result.current.setExportScale(3);
      result.current.setExportFilename("  Portrait.PNG  ");
      result.current.open();
    });
    expect(result.current.previewDataUrl).toBeNull();
    runFrames();
    expect(result.current.previewDataUrl).toBe("data:image/png;base64,preview");

    act(() => result.current.confirmSave());

    expect(canvases).toHaveLength(1);
    expect(canvases[0].width).toBe(6);
    expect(canvases[0].height).toBe(3);
    // Preview and download each upload the composite once at scale 1 and blit it up with smoothing off.
    expect(calls.map((call) => call.name)).toEqual(["putImageData", "drawImage", "putImageData", "drawImage"]);
    const upload = calls[2].args[0] as ImageDataStub;
    expect(upload.data.buffer).toBe(composite.data.buffer);
    expect([upload.width, upload.height]).toEqual([2, 1]);
    expect([calls[2].canvas.width, calls[2].canvas.height]).toEqual([2, 1]);
    expect(calls[3].canvas).toBe(canvases[0]);
    expect(calls[3].args.slice(1)).toEqual([0, 0, 2, 1, 0, 0, 6, 3]);
    expect(calls[3].smoothing).toBe(false);
    expect(click).toHaveBeenCalledOnce();
    expect(downloadName).toBe("Portrait.PNG");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pixel-art");
    expect(result.current.isOpen).toBe(false);
    expect(result.current.previewDataUrl).toBeNull();
  });

  it("redraws the open preview from the composite when its version changes", () => {
    const runFrames = stubFrames();
    const uploads: Uint32Array[] = [];
    const context = {
      putImageData: vi.fn((image: ImageDataStub) => uploads.push(new Uint32Array(image.data.buffer.slice(0)))),
      drawImage: vi.fn(),
      imageSmoothingEnabled: true,
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    let urls = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => `data:image/png;base64,${++urls}`);

    const compositeRef = { current: createBuffer(1, 1) };
    const { result, rerender } = renderHook(
      ({ compositeVersion }) => usePixelExport({ gridWidth: 1, gridHeight: 1, compositeRef, compositeVersion }),
      { initialProps: { compositeVersion: 0 } },
    );
    act(() => result.current.open());
    runFrames();
    expect(result.current.previewDataUrl).toBe("data:image/png;base64,1");
    expect(uploads.map((upload) => upload[0])).toEqual([0]);

    compositeRef.current.data[0] = packColor("#abcdef");
    rerender({ compositeVersion: 1 });
    runFrames();
    expect(result.current.previewDataUrl).toBe("data:image/png;base64,2");
    expect(uploads.map((upload) => upload[0])).toEqual([0, packColor("#abcdef")]);
  });

  it("hides scales whose output exceeds 16384 pixels", () => {
    const scalesFor = (gridWidth: number, gridHeight: number) =>
      renderHook(() =>
        usePixelExport({ gridWidth, gridHeight, compositeRef: { current: createBuffer(1, 1) }, compositeVersion: 0 }),
      ).result.current.availableScales;
    expect(scalesFor(2048, 2048)).toEqual([1, 3, 5]);
    expect(scalesFor(1700, 100)).toEqual([1, 3, 5]);
    expect(scalesFor(32, 32)).toEqual([1, 3, 5, 10]);
  });

  it("falls back to 1X when the selected scale stops being available", () => {
    const compositeRef = { current: createBuffer(1, 1) };
    const { result, rerender } = renderHook(
      ({ size }) => usePixelExport({ gridWidth: size, gridHeight: size, compositeRef, compositeVersion: 0 }),
      { initialProps: { size: 32 } },
    );
    act(() => result.current.setExportScale(10));
    expect(result.current.exportScale).toBe(10);

    rerender({ size: 2048 });
    expect(result.current.exportScale).toBe(1);
  });
});
