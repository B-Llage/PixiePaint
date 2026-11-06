import { useCallback, useMemo, useState } from "react";

import { EXPORT_SCALES } from "../PixelPencil.constants";
import type { PixelValue } from "../PixelPencilTypes";

interface UsePixelExportParams {
  gridWidth: number;
  gridHeight: number;
  pixels: PixelValue[];
  indexToCoords: (index: number) => { x: number; y: number };
}

export function usePixelExport({
  gridWidth,
  gridHeight,
  pixels,
  indexToCoords,
}: UsePixelExportParams) {
  const [isOpen, setIsOpen] = useState(false);
  const [exportScale, setExportScale] =
    useState<(typeof EXPORT_SCALES)[number]>(1);
  const [exportFilename, setExportFilename] = useState("pixel-art");

  const createExportCanvas = useCallback(
    (scale: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = gridWidth * scale;
      canvas.height = gridHeight * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }

      ctx.imageSmoothingEnabled = false;

      for (let index = 0; index < pixels.length; index += 1) {
        const color = pixels[index];
        if (color === null || color === "transparent") {
          continue;
        }
        const { x, y } = indexToCoords(index);
        const drawX = x * scale;
        const drawY = y * scale;
        ctx.fillStyle = color;
        ctx.fillRect(drawX, drawY, scale, scale);
      }

      return canvas;
    },
    [gridHeight, gridWidth, indexToCoords, pixels],
  );

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const confirmSave = useCallback(() => {
    const canvas = createExportCanvas(exportScale);
    if (!canvas) {
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const trimmed = exportFilename.trim() || "pixel-art";
      const finalName = trimmed.toLowerCase().endsWith(".png")
        ? trimmed
        : `${trimmed}.png`;
      const link = document.createElement("a");
      link.href = url;
      link.download = finalName;
      link.click();
      URL.revokeObjectURL(url);
    }, "image/png");
    setIsOpen(false);
  }, [createExportCanvas, exportFilename, exportScale]);

  const previewDataUrl = useMemo(() => {
    if (!isOpen) {
      return null;
    }
    const canvas = createExportCanvas(exportScale);
    if (!canvas) {
      return null;
    }
    return canvas.toDataURL("image/png");
  }, [createExportCanvas, exportScale, isOpen]);

  return {
    isOpen,
    open,
    close,
    exportScale,
    setExportScale,
    exportFilename,
    setExportFilename,
    previewDataUrl,
    confirmSave,
  };
}
