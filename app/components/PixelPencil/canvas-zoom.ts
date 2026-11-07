/** Smallest and largest margin, in CSS pixels, around the artwork at the fit zoom. */
export const FIT_ZOOM_MIN_PADDING = 16;
export const FIT_ZOOM_MAX_PADDING = 64;
/** Fit-zoom margin as a fraction of the viewport's shorter side, before clamping. */
export const FIT_ZOOM_PADDING_RATIO = 0.06;

/**
 * Margin left on every side of the artwork at the fit zoom: a share of the
 * viewport's shorter side, clamped to a comfortable range, and never more
 * than a quarter of it so tiny viewports keep most of their space for art.
 */
export function getFitZoomPadding(viewportWidth: number, viewportHeight: number): number {
  const shortSide = Math.min(viewportWidth, viewportHeight);
  if (shortSide <= 0) return 0;
  const padding = Math.min(
    FIT_ZOOM_MAX_PADDING,
    Math.max(FIT_ZOOM_MIN_PADDING, shortSide * FIT_ZOOM_PADDING_RATIO),
  );
  return Math.min(padding, shortSide / 4);
}

/**
 * Smallest zoom scale: the one that shows the whole artwork inside the
 * viewport with padding on every side. Never larger than 1, so the default
 * view stays the smallest zoom when it already fits with that padding.
 */
export function getFitZoomScale(
  gridWidth: number,
  gridHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  baseCellSize: number,
): number {
  if (
    gridWidth <= 0 ||
    gridHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    baseCellSize <= 0
  ) {
    return 1;
  }
  const padding = getFitZoomPadding(viewportWidth, viewportHeight);
  const fitCellSize = Math.min(
    (viewportWidth - padding * 2) / gridWidth,
    (viewportHeight - padding * 2) / gridHeight,
  );
  return Math.min(1, fitCellSize / baseCellSize);
}

export function clampZoomScale(scale: number, minScale: number, maxScale: number): number {
  return Math.min(maxScale, Math.max(Math.min(minScale, maxScale), scale));
}

/**
 * Zoom steps are whole multiples above 1x and halvings below it, ending at
 * the fit scale so the whole artwork, with padding, is reachable.
 */
export function getNextZoomScale(
  current: number,
  direction: "in" | "out",
  steps: number,
  minScale: number,
  maxScale: number,
): number {
  let scale = clampZoomScale(current, minScale, maxScale);
  for (let step = 0; step < Math.max(0, steps); step += 1) {
    if (direction === "in") {
      scale = scale < 1 ? Math.min(1, scale * 2) : scale + 1;
    } else {
      scale = scale > 1 ? Math.max(1, scale - 1) : scale / 2;
    }
    scale = clampZoomScale(scale, minScale, maxScale);
  }
  return scale;
}
