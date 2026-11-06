import { useEffect, useMemo, useState } from "react";

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
 */
export function useLayerPreviews(
  layers: readonly Layer[],
  gridWidth: number,
  gridHeight: number,
): Record<string, string> {
  const [generated, setGenerated] = useState<Record<string, string>>(NO_PREVIEWS);
  const hasArtwork = layers.length > 0 && gridWidth > 0 && gridHeight > 0;

  useEffect(() => {
    if (!hasArtwork || typeof window === "undefined") return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const previews = renderLayerPreviews(layers, gridWidth, gridHeight);
      if (previews && !cancelled) {
        setGenerated(previews);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [gridHeight, gridWidth, hasArtwork, layers]);

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
): Record<string, string> | null {
  const maxDimension = Math.max(gridWidth, gridHeight);
  const scale = Math.max(1, Math.floor(LAYER_PREVIEW_MAX_SIZE / maxDimension));
  const canvas = document.createElement("canvas");
  canvas.width = gridWidth * scale;
  canvas.height = gridHeight * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;

  const checkerSize = Math.max(scale, 2);
  const previews: Record<string, string> = {};

  const drawCheckerboard = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e4e4e7";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#f4f4f5";
    for (let y = 0; y < canvas.height; y += checkerSize) {
      const offset = (Math.floor(y / checkerSize) % 2) * checkerSize;
      for (let x = offset; x < canvas.width; x += checkerSize * 2) {
        ctx.fillRect(x, y, checkerSize, checkerSize);
      }
    }
  };

  for (const layer of layers) {
    drawCheckerboard();
    ctx.globalAlpha = layer.visible ? 1 : 0.4;
    for (let index = 0; index < layer.pixels.length; index += 1) {
      const color = layer.pixels[index];
      if (color === null || color === "transparent") continue;
      ctx.fillStyle = color;
      ctx.fillRect((index % gridWidth) * scale, Math.floor(index / gridWidth) * scale, scale, scale);
    }
    ctx.globalAlpha = 1;
    previews[layer.id] = canvas.toDataURL("image/png");
  }

  return previews;
}
