import { PaintTool } from "./PixelPencilTypes";

export const RectSelectionTool = {
  id: "rect-select",
  label: "Select",
  icon: "/icons/tools/RectangularSelector.png",
  cursorIcon: "/icons/cursors/RectangularSelector.png",
  cursorHotspot: { x: 0, y: 0 },
  settings: {},
  hotkey: "r",
} as const satisfies PaintTool;

export const MoveTool = {
  id: "move",
  label: "Move",
  icon: "/icons/tools/move.png",
  cursorIcon: "/icons/cursors/move.png",
  cursorHotspot: { x: 0, y: 0 },
  settings: { autoPickLayer: true },
  hotkey: "m",
} as const satisfies PaintTool;

export const PencilTool = {
  id: "pencil",
  label: "Pencil",
  icon: "/icons/tools/Pencil.png",
  cursorIcon: "/icons/cursors/Pencil.png",
  cursorHotspot: { x: 14, y: 28 },
  settings: {
    brushSize: true,
    brushShape: true,
  },
  hotkey: "q",
} as const satisfies PaintTool;

export const LineTool = {
  id: "line",
  label: "Line",
  icon: "/icons/tools/Line.png",
  cursorIcon: "/icons/cursors/Line.png",
  cursorHotspot: { x: 2, y: 28 },
  settings: {
    brushSize: true,
    brushShape: true,
  },
  hotkey: "d",
} as const satisfies PaintTool;

export const ShapeTool = {
  id: "shape",
  label: "Shape",
  icon: "/icons/tools/Shape.png",
  cursorIcon: "/icons/cursors/Shape.png",
  cursorHotspot: { x: 0, y: 0 },
  settings: {
    brushSize: true,
    shapeType: true,
    shapeFilled: true,
  },
  hotkey: "s",
} as const satisfies PaintTool;

export const ColorPickerTool = {
  id: "picker",
  label: "Picker",
  icon: "/icons/tools/ColorPicker.png",
  cursorIcon: "/icons/cursors/ColorPicker.png",
  cursorHotspot: { x: 2, y: 26 },
  settings: {},
  hotkey: "e",
} as const satisfies PaintTool;

export const BucketTool = {
  id: "bucket",
  label: "Bucket",
  icon: "/icons/tools/Bucket.png",
  cursorIcon: "/icons/cursors/Bucket.png",
  cursorHotspot: { x: 2, y: 28 },
  settings: {},
  hotkey: "g",
} as const satisfies PaintTool;

export const EraserTool = {
  id: "eraser",
  label: "Eraser",
  icon: "/icons/tools/Eraser.png",
  cursorIcon: "/icons/cursors/Eraser.png",
  cursorHotspot: { x: 14, y: 2 },
  settings: {
    brushSize: true,
    brushShape: true,
  },
  hotkey: "w",
} as const satisfies PaintTool;

export const MagnifierTool = {
  id: "magnifier",
  label: "Magnifier",
  icon: "/icons/tools/MagnifyingGlass.png",
  cursorIcon: "/icons/cursors/MagnifyingGlass.png",
  cursorHotspot: { x: 0, y: 0 },
  settings: {
    zoomMode: true,
  },
  hotkey: "a",
} as const satisfies PaintTool;

/** Toolbar order. Also the source of truth for the Hotkeys dialog. */
export const TOOLS = [
  PencilTool,
  EraserTool,
  BucketTool,
  ColorPickerTool,
  LineTool,
  ShapeTool,
  RectSelectionTool,
  MoveTool,
  MagnifierTool,
] as const;

export type ToolId = (typeof TOOLS)[number]["id"];
