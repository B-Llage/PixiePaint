/**
 * Smallest zoom scale that shows the whole artwork inside the viewport.
 * Never larger than 1, so the default view stays the smallest zoom when it
 * already fits.
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
  const fitCellSize = Math.min(viewportWidth / gridWidth, viewportHeight / gridHeight);
  return Math.min(1, fitCellSize / baseCellSize);
}

export function clampZoomScale(scale: number, minScale: number, maxScale: number): number {
  return Math.min(maxScale, Math.max(Math.min(minScale, maxScale), scale));
}

/**
 * Zoom steps are whole multiples above 1x and halvings below it, ending at
 * the fit scale so the whole artwork is reachable.
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
