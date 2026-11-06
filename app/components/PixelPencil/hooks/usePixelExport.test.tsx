import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBuffer, packColor, TRANSPARENT_PIXEL } from "../pixel-buffer";
import { usePixelExport } from "./usePixelExport";

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
  it("exports only opaque pixels at the selected PNG scale and filename", () => {
    const runFrames = stubFrames();
    const fillRect = vi.fn();
    const canvases: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect,
      imageSmoothingEnabled: true,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D);
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
    expect(fillRect).toHaveBeenCalledTimes(2); // preview and download, one opaque cell each
    expect(fillRect).toHaveBeenCalledWith(0, 0, 3, 3);
    expect(click).toHaveBeenCalledOnce();
    expect(downloadName).toBe("Portrait.PNG");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pixel-art");
    expect(result.current.isOpen).toBe(false);
    expect(result.current.previewDataUrl).toBeNull();
  });

  it("redraws the open preview from the composite when its version changes", () => {
    const runFrames = stubFrames();
    const fillStyles: string[] = [];
    const context = {
      fillRect: vi.fn(() => fillStyles.push(context.fillStyle)),
      imageSmoothingEnabled: true,
      fillStyle: "",
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
    expect(fillStyles).toEqual([]);

    compositeRef.current.data[0] = packColor("#abcdef");
    rerender({ compositeVersion: 1 });
    runFrames();
    expect(result.current.previewDataUrl).toBe("data:image/png;base64,2");
    expect(fillStyles).toEqual(["#abcdef"]);
  });
});
