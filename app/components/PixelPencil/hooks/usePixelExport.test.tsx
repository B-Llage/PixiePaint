import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePixelExport } from "./usePixelExport";

afterEach(() => vi.restoreAllMocks());

describe("usePixelExport", () => {
  it("exports only opaque pixels at the selected PNG scale and filename", () => {
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

    const { result } = renderHook(() => usePixelExport({
      gridWidth: 2,
      gridHeight: 1,
      pixels: ["#123456", "transparent"],
      indexToCoords: (index) => ({ x: index, y: 0 }),
    }));

    act(() => {
      result.current.setExportScale(3);
      result.current.setExportFilename("  Portrait.PNG  ");
      result.current.open();
    });
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
  });
});
