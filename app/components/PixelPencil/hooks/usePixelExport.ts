import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";

import { EXPORT_SCALES, MAX_EXPORT_DIMENSION } from "../PixelPencil.constants";
import { imageDataFromBuffer, type PixelBuffer } from "../pixel-buffer";

interface UsePixelExportParams {
  gridWidth: number;
  gridHeight: number;
  /** The flattened composite the PNG is drawn from. */
  compositeRef: RefObject<PixelBuffer>;
  /** Bumps whenever the composite changes, so an open preview redraws. */
  compositeVersion: number;
}

/**
 * The Save PNG dialog: scale, filename, a live preview while open, and the download.
 *
 * The preview reads the composite outside render: it is drawn on the animation frame after the
 * dialog opens, the scale changes, or the composite changes, and is null until then.
 */
export function usePixelExport({
  gridWidth,
  gridHeight,
  compositeRef,
  compositeVersion,
}: UsePixelExportParams) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedScale, setExportScale] =
    useState<(typeof EXPORT_SCALES)[number]>(1);
  const availableScales = useMemo(
    () =>
      EXPORT_SCALES.filter(
        (scale) =>
          scale === 1 ||
          (gridWidth * scale <= MAX_EXPORT_DIMENSION && gridHeight * scale <= MAX_EXPORT_DIMENSION),
      ),
    [gridHeight, gridWidth],
  );
  // A selection the grid has outgrown falls back to 1 without any effect or extra render.
  const exportScale = availableScales.includes(selectedScale) ? selectedScale : 1;
  const [exportFilename, setExportFilename] = useState("pixel-art");
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

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

      // One upload of the composite at scale 1, then one nearest-neighbor blit to the output size.
      const source = document.createElement("canvas");
      source.width = gridWidth;
      source.height = gridHeight;
      const sourceCtx = source.getContext("2d");
      if (!sourceCtx) {
        return null;
      }
      sourceCtx.putImageData(imageDataFromBuffer(compositeRef.current), 0, 0);
      ctx.drawImage(source, 0, 0, gridWidth, gridHeight, 0, 0, canvas.width, canvas.height);

      return canvas;
    },
    [compositeRef, gridHeight, gridWidth],
  );

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPreviewDataUrl(null);
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
    setPreviewDataUrl(null);
  }, [createExportCanvas, exportFilename, exportScale]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const canvas = createExportCanvas(exportScale);
      if (!cancelled) setPreviewDataUrl(canvas ? canvas.toDataURL("image/png") : null);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [compositeVersion, createExportCanvas, exportScale, isOpen]);

  return {
    isOpen,
    open,
    close,
    exportScale,
    availableScales,
    setExportScale,
    exportFilename,
    setExportFilename,
    previewDataUrl,
    confirmSave,
  };
}
