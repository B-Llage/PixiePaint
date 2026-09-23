import { BrushShapeSelector } from "./Settings/Tool/BrushShapeSelector";
import { BrushSizeSelector } from "./Settings/Tool/BrushSizeSelector";
import { ShapeSelector } from "./Settings/Tool/ShapeSelector";
import { ZoomModeSelector } from "./Settings/Tool/ZoomModeSelector";
import { BRUSH_SHAPES, SHAPE_TYPES } from "./PixelPencil.constants";
import { PaintTool, ShapeKind, BrushShape } from "./PixelPencilTypes";
import { ZoomMode } from "./hooks/useZoomControls";

interface ToolSettingsPanelProps {
  currentTool: PaintTool;
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  onBrushSizeDragChange: (dragging: boolean) => void;
  brushShape: BrushShape;
  onBrushShapeChange: (shape: BrushShape) => void;
  shapeType: ShapeKind;
  onShapeTypeChange: (shape: ShapeKind) => void;
  shapeFilled: boolean;
  onShapeFilledChange: (filled: boolean) => void;
  zoomMode: ZoomMode;
  onZoomModeChange: (mode: ZoomMode) => void;
  autoPickLayer: boolean;
  onAutoPickLayerChange: (enabled: boolean) => void;
}

export function ToolSettingsPanel({
  currentTool,
  brushSize,
  onBrushSizeChange,
  onBrushSizeDragChange,
  brushShape,
  onBrushShapeChange,
  shapeType,
  onShapeTypeChange,
  shapeFilled,
  onShapeFilledChange,
  zoomMode,
  onZoomModeChange,
  autoPickLayer,
  onAutoPickLayerChange,
}: ToolSettingsPanelProps) {
  return (
    <div data-tool-settings className="flex h-12 min-w-0 items-center gap-4">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-300">
        Tool Settings
      </span>
      <div className="flex h-full min-w-0 flex-1 items-center gap-5 overflow-x-auto overflow-y-hidden [&>div]:shrink-0" style={{ scrollbarWidth: "none" }}>
        {currentTool.settings.brushSize && (
          <BrushSizeSelector
            value={brushSize}
            onChange={onBrushSizeChange}
            onDragChange={onBrushSizeDragChange}
          />
        )}

        {currentTool.settings.brushShape && (
          <BrushShapeSelector
            options={BRUSH_SHAPES}
            value={brushShape}
            onChange={(value) => {
              const newShape = typeof value === "function" ? value(brushShape) : value;
              onBrushShapeChange(newShape);
            }}
          />
        )}

        {currentTool.settings.shapeType && (
          <ShapeSelector
            options={SHAPE_TYPES}
            value={shapeType}
            onChange={(value) => {
              const newShape = typeof value === "function" ? value(shapeType) : value;
              onShapeTypeChange(newShape);
            }}
          />
        )}

        {currentTool.settings.shapeFilled && (
          <label className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-200">
            <span className="font-medium uppercase">Filled Shape</span>
            <input
              type="checkbox"
              checked={shapeFilled}
              onChange={(event) => onShapeFilledChange(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-600 dark:text-white dark:focus:ring-white"
            />
          </label>
        )}

        {currentTool.settings.zoomMode && (
          <ZoomModeSelector value={zoomMode} onChange={onZoomModeChange} />
        )}

        {currentTool.settings.autoPickLayer && (
          <label className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-zinc-700 bg-zinc-800 px-3 text-xs text-zinc-200">
            <span className="font-medium uppercase">Auto Pick Layer</span>
            <input
              type="checkbox"
              checked={autoPickLayer}
              onChange={(event) => onAutoPickLayerChange(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-600 dark:text-white dark:focus:ring-white"
            />
          </label>
        )}
      </div>
    </div>
  );
}
