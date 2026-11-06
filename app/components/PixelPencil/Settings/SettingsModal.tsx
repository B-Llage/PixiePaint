import {
  CHECKER_SIZE_OPTIONS,
  usePixelPencilSettings,
} from "../context/PixelPencilSettingsContext";
import { GridDimensionInput } from "./GridDimensionInput";


interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const {
        previewToolEffects,
        setPreviewToolEffects,
        dimStrokePreview,
        setDimStrokePreview,
        useToolAsMousePointer,
        setUseToolAsMousePointer,
        gridWidth,
        setGridWidth,
        gridHeight,
        setGridHeight,
        showPixelGrid,
        setShowPixelGrid,
        checkerSize,
        setCheckerSize,
      } = usePixelPencilSettings();

    return <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={onClose}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id="settings-dialog-title"
              className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
            >
              Pixel Pencil Settings
            </h2>
            <div className="mt-4 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Preview Tool Effects
                  </span>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Show live tool previews while hovering over or drawing on the canvas.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={previewToolEffects}
                    onChange={(event) => setPreviewToolEffects(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-600 dark:text-white dark:focus:ring-white"
                  />
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    Enabled
                  </span>
                </label>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor="dim-stroke-preview" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Dim Stroke Preview
                  </label>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Darken tool previews while hovering or drawing. When off, previews show the color that will be applied.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <input
                    id="dim-stroke-preview"
                    type="checkbox"
                    checked={dimStrokePreview}
                    onChange={(event) => setDimStrokePreview(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-600 dark:text-white dark:focus:ring-white"
                  />
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    Enabled
                  </span>
                </label>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <label htmlFor="use-tool-as-mouse-pointer" className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Use Tool as Mouse Pointer
                  </label>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Show the selected tool icon as the pointer over the canvas.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <input
                    id="use-tool-as-mouse-pointer"
                    type="checkbox"
                    checked={useToolAsMousePointer}
                    onChange={(event) => setUseToolAsMousePointer(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-600 dark:text-white dark:focus:ring-white"
                  />
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    Enabled
                  </span>
                </label>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Pixel Grid
                  </span>
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Toggle the borders between individual pixels on the canvas.
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={showPixelGrid}
                    onChange={(event) => setShowPixelGrid(event.target.checked)}
                    className="h-4 w-4 rounded border-zinc-300 text-black focus:ring-black dark:border-zinc-600 dark:text-white dark:focus:ring-white"
                  />
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    Visible
                  </span>
                </label>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start gap-4">
                  <GridDimensionInput
                    label="Grid Width"
                    value={gridWidth}
                    onCommit={setGridWidth}
                  />
                  <GridDimensionInput
                    label="Grid Height"
                    value={gridHeight}
                    onCommit={setGridHeight}
                  />
                </div>
                {gridWidth > 1024 || gridHeight > 1024 ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Very large canvases need a desktop browser.
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  Checker Size
                </span>
                <div className="flex flex-wrap gap-3">
                  {CHECKER_SIZE_OPTIONS.map((size) => {
                    const isSelected = size === checkerSize;
                    return (
                      <button
                        key={`checker-size-${size}`}
                        type="button"
                        className={`rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${
                          isSelected
                            ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                            : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                        onClick={() => setCheckerSize(size)}
                      >
                        {size}px
                      </button>
                    );
                  })}
                </div>
              </div>
             
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
              >
                Close
              </button>
            </div>
          </div>
        </div>;
}
