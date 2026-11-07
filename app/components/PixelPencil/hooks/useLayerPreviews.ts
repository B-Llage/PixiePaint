import { useEffect, useMemo, useRef, useState } from "react";

import { imageDataFromBuffer } from "../pixel-buffer";
import type { Layer } from "../PixelPencilTypes";

const LAYER_PREVIEW_MAX_SIZE = 64; // px, longest side of a layer thumbnail

const NO_PREVIEWS: Record<string, string> = {};

/**
 * Thumbnails of each layer, keyed by layer id, for the layers panel.
 *
 * Thumbnails are rasterized in a requestAnimationFrame callback after the
 * layers change, so a burst of edits produces one render per frame at most.
 * The returned map only ever holds entries for the current layers: while a
 * frame is pending, a layer that still exists keeps its previous thumbnail and
 * a new one has none. An empty grid or no layers yields an empty map without
 * scheduling a frame.
 *
 * Layer buffers are edited in place, so the layers array alone does not reveal
 * pixel edits: the caller bumps `previewVersion` when thumbnails should catch up.
 */
export function useLayerPreviews(
  layers: readonly Layer[],
  gridWidth: number,
  gridHeight: number,
  previewVersion: number,
): Record<string, string> {
  const [generated, setGenerated] = useState<Record<string, string>>(NO_PREVIEWS);
  const hasArtwork = layers.length > 0 && gridWidth > 0 && gridHeight > 0;
  // Offscreen canvas the layer bytes are uploaded to; reused across renders, resized with the grid.
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Intermediate canvas for stepwise downscaling of large grids.
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!hasArtwork || typeof window === "undefined") return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const previews = renderLayerPreviews(layers, gridWidth, gridHeight, sourceCanvasRef, scratchCanvasRef);
      if (previews && !cancelled) {
        setGenerated(previews);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [gridHeight, gridWidth, hasArtwork, layers, previewVersion]);

  return useMemo(() => {
    if (!hasArtwork) return NO_PREVIEWS;
    const current: Record<string, string> = {};
    for (const layer of layers) {
      const preview = generated[layer.id];
      if (preview !== undefined) current[layer.id] = preview;
    }
    return current;
  }, [generated, hasArtwork, layers]);
}

function renderLayerPreviews(
  layers: readonly Layer[],
  gridWidth: number,
  gridHeight: number,
  sourceCanvasRef: { current: HTMLCanvasElement | null },
  scratchCanvasRef: { current: HTMLCanvasElement | null },
): Record<string, string> | null {
  const maxDimension = Math.max(gridWidth, gridHeight);
  const thumbWidth = thumbnailLength(gridWidth, maxDimension);
  const thumbHeight = thumbnailLength(gridHeight, maxDimension);
  const canvas = document.createElement("canvas");
  canvas.width = thumbWidth;
  canvas.height = thumbHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const source = sourceCanvasRef.current ?? document.createElement("canvas");
  sourceCanvasRef.current = source;
  if (source.width !== gridWidth) source.width = gridWidth;
  if (source.height !== gridHeight) source.height = gridHeight;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return null;

  // Grids above the thumbnail size are halved (smoothed) until within 2x of it, then drawn once more.
  const halvings: Array<{ width: number; height: number }> = [];
  for (let w = gridWidth, h = gridHeight; Math.max(w, h) > 2 * LAYER_PREVIEW_MAX_SIZE; ) {
    w = Math.max(1, Math.ceil(w / 2));
    h = Math.max(1, Math.ceil(h / 2));
    halvings.push({ width: w, height: h });
  }
  const downscaling = maxDimension > LAYER_PREVIEW_MAX_SIZE;
  let scratch: HTMLCanvasElement | null = null;
  let scratchCtx: CanvasRenderingContext2D | null = null;
  if (halvings.length > 0) {
    scratch = scratchCanvasRef.current ?? document.createElement("canvas");
    scratchCanvasRef.current = scratch;
    if (scratch.width !== halvings[0].width) scratch.width = halvings[0].width;
    if (scratch.height !== halvings[0].height) scratch.height = halvings[0].height;
    scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return null;
    scratchCtx.imageSmoothingEnabled = true;
    scratchCtx.imageSmoothingQuality = "high";
    // Each step replaces the scratch contents (it may draw from its own previous step).
    scratchCtx.globalCompositeOperation = "copy";
  }

  const checkerSize = Math.max(Math.floor(thumbWidth / gridWidth), 2);
  const previews: Record<string, string> = {};

  const drawCheckerboard = () => {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, thumbWidth, thumbHeight);
    ctx.fillStyle = "#e4e4e7";
    ctx.fillRect(0, 0, thumbWidth, thumbHeight);
    ctx.fillStyle = "#f4f4f5";
    for (let y = 0; y < thumbHeight; y += checkerSize) {
      const offset = (Math.floor(y / checkerSize) % 2) * checkerSize;
      for (let x = offset; x < thumbWidth; x += checkerSize * 2) {
        ctx.fillRect(x, y, checkerSize, checkerSize);
      }
    }
  };

  for (const layer of layers) {
    drawCheckerboard();
    // One upload of the layer's own bytes, then one scaled blit.
    sourceCtx.putImageData(imageDataFromBuffer(layer.pixels), 0, 0);
    let from: HTMLCanvasElement = source;
    let fromWidth = gridWidth;
    let fromHeight = gridHeight;
    if (scratch && scratchCtx) {
      for (const step of halvings) {
        scratchCtx.drawImage(from, 0, 0, fromWidth, fromHeight, 0, 0, step.width, step.height);
        from = scratch;
        fromWidth = step.width;
        fromHeight = step.height;
      }
    }
    ctx.imageSmoothingEnabled = downscaling;
    if (downscaling) ctx.imageSmoothingQuality = "high";
    ctx.globalAlpha = layer.visible ? 1 : 0.4;
    ctx.drawImage(from, 0, 0, fromWidth, fromHeight, 0, 0, thumbWidth, thumbHeight);
    ctx.globalAlpha = 1;
    previews[layer.id] = canvas.toDataURL("image/png");
  }

  return previews;
}

/** Whole-number scale for small grids; proportional shrink once the grid exceeds the thumbnail size. */
function thumbnailLength(length: number, maxDimension: number): number {
  if (maxDimension <= LAYER_PREVIEW_MAX_SIZE) {
    return length * Math.floor(LAYER_PREVIEW_MAX_SIZE / maxDimension);
  }
  return Math.max(1, Math.round((length * LAYER_PREVIEW_MAX_SIZE) / maxDimension));
}
