import { BRUSH_SHAPES, SHAPE_TYPES, ZOOM_MODE_OPTIONS } from "./PixelPencil.constants";

export interface PaintTool {
  id: string;
  label: string;
  icon: string;
  cursorIcon: string;
  cursorHotspot: { x: number; y: number };
  hotkey?: string;
  settings: {
    brushSize?: boolean;
    brushShape?: boolean;
    shapeType?: boolean;
    shapeFilled?: boolean;
    zoomMode?: boolean;
    autoPickLayer?: boolean;
  };
}

export interface PaletteTheme {
  id: string;
  name: string;
  colors: readonly string[];
}

export type PaletteColor = string | "transparent";
export type PixelValue = PaletteColor | null;

export type BrushShape = (typeof BRUSH_SHAPES)[number]["id"];
export type ShapeKind = (typeof SHAPE_TYPES)[number]["id"];
export type ZoomMode = (typeof ZOOM_MODE_OPTIONS)[number]["id"];

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionPixel {
  relX: number;
  relY: number;
  color: PixelValue;
}

/** A rectangular selection. While `isFloating`, its pixels are lifted off the layer and drawn at `offset`. */
export interface SelectionState {
  rect: SelectionRect;
  offset: { dx: number; dy: number };
  pixels: SelectionPixel[];
  isFloating: boolean;
}
