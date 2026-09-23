export const MIN_VISIBLE_CANVAS_PIXELS = 216;

export type PanBounds = { min: number; max: number };

export function getPanBounds(
  contentSize: number,
  viewportSize: number,
  baseOffset: number,
): PanBounds {
  if (contentSize <= 0 || viewportSize <= 0) return { min: 0, max: 0 };
  const visibleSize = Math.min(MIN_VISIBLE_CANVAS_PIXELS, contentSize, viewportSize);
  return {
    min: baseOffset - viewportSize + visibleSize,
    max: baseOffset + contentSize - visibleSize,
  };
}

export function clampPan(value: number, bounds: PanBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function includePanOffset(bounds: PanBounds, offset: number): PanBounds {
  return {
    min: Math.min(bounds.min, offset),
    max: Math.max(bounds.max, offset),
  };
}
