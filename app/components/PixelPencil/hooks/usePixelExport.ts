import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";

import { EXPORT_SCALES, MAX_EXPORT_DIMENSION, MAX_EXPORT_PREVIEW_DIMENSION } from "../PixelPencil.constants";
import { imageDataFromBuffer, type PixelBuffer } from "../pixel-buffer";

const SAVE_ERROR_MESSAGE = "Could not render the PNG at this size.";

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
  // The selection belongs to one grid size: a resize clears it (adjust state during render, no effect),
  // so a scale hidden by a resize does not resurface when the grid shrinks again.
  const [scalesForSize, setScalesForSize] = useState({ width: gridWidth, height: gridHeight });
  if (scalesForSize.width !== gridWidth || scalesForSize.height !== gridHeight) {
    setScalesForSize({ width: gridWidth, height: gridHeight });
    setExportScale(1);
  }
  const availableScales = useMemo(
    () =>
      EXPORT_SCALES.filter(
        (scale) =>
          scale === 1 ||
          (gridWidth * scale <= MAX_EXPORT_DIMENSION && gridHeight * scale <= MAX_EXPORT_DIMENSION),
      ),
    [gridHeight, gridWidth],
  );
  // Within the render that sees a resize, the stale selection also reads as 1.
  const exportScale = availableScales.includes(selectedScale) ? selectedScale : 1;
  const [exportFilename, setExportFilename] = useState("pixel-art");
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);
  // The error belongs to one scale: choosing another clears it (adjust state during render, no effect).
  const [errorScale, setErrorScale] = useState(exportScale);
  if (errorScale !== exportScale) {
    setErrorScale(exportScale);
    setSaveError(null);
  }

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

  // The preview is bounded so a large grid at 5X does not allocate and PNG-encode the full output.
  const previewScale = Math.max(
    1,
    Math.min(exportScale, Math.floor(MAX_EXPORT_PREVIEW_DIMENSION / Math.max(gridWidth, gridHeight))),
  );

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPreviewDataUrl(null);
    setSaveError(null);
  }, []);

  const confirmSave = useCallback(() => {
    const canvas = createExportCanvas(exportScale);
    if (!canvas) {
      setSaveError(SAVE_ERROR_MESSAGE);
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
    setSaveError(null);
    setIsOpen(false);
    setPreviewDataUrl(null);
  }, [createExportCanvas, exportFilename, exportScale]);

  useEffect(() => {
    if (!isOpen || typeof window === "undefined") return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const canvas = createExportCanvas(previewScale);
      if (!cancelled) setPreviewDataUrl(canvas ? canvas.toDataURL("image/png") : null);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [compositeVersion, createExportCanvas, isOpen, previewScale]);

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
    saveError,
    confirmSave,
  };
}
