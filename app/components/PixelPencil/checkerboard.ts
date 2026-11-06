export const CHECKERBOARD_COLOR = "#d1d5db";

/** CSS background styles for a two-tone checkerboard with `cellSize` px squares. */
export function checkerboardStyle(
  cellSize: number,
  color: string = CHECKERBOARD_COLOR,
): { backgroundImage: string; backgroundSize: string; backgroundPosition: string } {
  const half = cellSize / 2;
  const gradient = `linear-gradient(45deg, ${color} 25%, transparent 25%, transparent 75%, ${color} 75%, ${color})`;
  return {
    backgroundImage: `${gradient}, ${gradient}`,
    backgroundSize: `${cellSize}px ${cellSize}px`,
    backgroundPosition: `0 0, ${half}px ${half}px`,
  };
}
