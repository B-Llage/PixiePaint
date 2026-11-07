export const TRANSPARENT_LIGHT = "#d4d4d8";
export const TRANSPARENT_DARK = "#9ca3af";

export const MAX_HISTORY = 15;

export const MAX_BRUSH_SIZE = 256;
export const EXPORT_SCALES = [1, 3, 5, 10] as const;
export const MAX_ZOOM_SCALE = 5;
export const MIN_CELL_SIZE_MOBILE = 1;
export const MIN_CELL_SIZE_DESKTOP = 4;

export const BRUSH_SHAPES = [
  { id: "square", label: "Square" },
  { id: "circle", label: "Circle" },
] as const;

export const ZOOM_MODE_OPTIONS = [
  { id: "in", label: "Zoom In" },
  { id: "out", label: "Zoom Out" },
] as const;

export const SHAPE_TYPES = [
  { id: "square", label: "Square" },
  { id: "circle", label: "Circle" },
  { id: "triangle", label: "Triangle" },
] as const;

export const MIN_GRID_DIMENSION = 1;
export const MAX_GRID_DIMENSION = 2048;
export const DEFAULT_GRID_DIMENSION = 32;
export const HISTORY_TILE_SIZE = 64;
export const HISTORY_BYTE_BUDGET = 256 * 1024 * 1024;
export const MAX_EXPORT_DIMENSION = 16384;
/** The Save PNG preview is drawn with its longest side at most this many pixels. */
export const MAX_EXPORT_PREVIEW_DIMENSION = 1024;
