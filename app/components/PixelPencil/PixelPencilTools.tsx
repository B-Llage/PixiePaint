import { PaintTool } from "./PixelPencilTypes";

export const RectSelectionTool: PaintTool = {
  id: "rect-select",
  label: "Select",
  icon: "/icons/tools/RectangularSelector.png",
  settings: {},
  hotkey: "r",
};

export const MoveTool: PaintTool = {
  id: "move",
  label: "Move",
  icon: "/icons/tools/move.png",
  settings: { autoPickLayer: true },
  hotkey: "m",
};

export const PencilTool: PaintTool = {
  id: "pencil",
  label: "Pencil",
  icon: "/icons/tools/Pencil.png",
  settings: {
    brushSize: true,
    brushShape: true,
  },
  hotkey: "q",
};

export const LineTool: PaintTool = {
  id: "line",
  label: "Line",
  icon: "/icons/tools/Line.png",
  settings: {
    brushSize: true,
    brushShape: true,
  },
  hotkey: "d",
};

export const ShapeTool: PaintTool = {
  id: "shape",
  label: "Shape",
  icon: "/icons/tools/Shape.png",
  settings: {
    brushSize: true,
    shapeType: true,
    shapeFilled: true,
  },
  hotkey: "s",
};

export const ColorPickerTool: PaintTool = {
  id: "picker",
  label: "Picker",
  icon: "/icons/tools/ColorPicker.png",
  settings: {},
  hotkey: "e",
};

export const BucketTool: PaintTool = {
  id: "bucket",
  label: "Bucket",
  icon: "/icons/tools/Bucket.png",
  settings: {},
  hotkey: "g",
};

export const EraserTool: PaintTool = {
  id: "eraser",
  label: "Eraser",
  icon: "/icons/tools/Eraser.png",
  settings: {
    brushSize: true,
    brushShape: true,
  },
  hotkey: "w",
};

export const MagnifierTool: PaintTool = {
  id: "magnifier",
  label: "Magnifier",
  icon: "/icons/tools/MagnifyingGlass.png",
  settings: {
    zoomMode: true,
  },
  hotkey: "a",
};
