import { Dispatch, SetStateAction } from "react";

import { ActionRequestModal } from "../shared/ActionRequestModal";
import { ChangelogModal } from "./Settings/ChangelogModal";
import { SettingsModal } from "./Settings/SettingsModal";
import { EXPORT_SCALES } from "./PixelPencil.constants";

interface HotkeyItem {
  label: string;
  key: string;
}

interface PixelPencilModalsProps {
  isSaveDialogOpen: boolean;
  handleCloseSaveDialog: () => void;
  handleConfirmSave: () => void;
  exportScale: (typeof EXPORT_SCALES)[number];
  exportScales: ReadonlyArray<(typeof EXPORT_SCALES)[number]>;
  setExportScale: Dispatch<SetStateAction<(typeof EXPORT_SCALES)[number]>>;
  exportFilename: string;
  setExportFilename: Dispatch<SetStateAction<string>>;
  previewDataUrl: string | null;
  gridWidth: number;
  gridHeight: number;
  isSettingsDialogOpen: boolean;
  handleCloseSettingsDialog: () => void;
  isChangelogDialogOpen: boolean;
  handleCloseChangelogDialog: () => void;
  isHotkeysDialogOpen: boolean;
  handleCloseHotkeysDialog: () => void;
  hotkeys: HotkeyItem[];
  isResetDialogOpen: boolean;
  handleCloseResetDialog: () => void;
  handleConfirmReset: () => void;
}

export function PixelPencilModals({
  isSaveDialogOpen,
  handleCloseSaveDialog,
  handleConfirmSave,
  exportScale,
  exportScales,
  setExportScale,
  exportFilename,
  setExportFilename,
  previewDataUrl,
  gridWidth,
  gridHeight,
  isSettingsDialogOpen,
  handleCloseSettingsDialog,
  isChangelogDialogOpen,
  handleCloseChangelogDialog,
  isHotkeysDialogOpen,
  handleCloseHotkeysDialog,
  hotkeys,
  isResetDialogOpen,
  handleCloseResetDialog,
  handleConfirmReset,
}: PixelPencilModalsProps) {
  return (
    <>
      {isSaveDialogOpen && (
        <ActionRequestModal
          title="Save PNG"
          handleClose={handleCloseSaveDialog}
          handleConfirm={handleConfirmSave}
          confirmText="Save"
          cancelText="Cancel"
          renderBody={() => (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Preview
                </span>
                <div className="flex items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
                  {previewDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL preview; next/image cannot optimize it
                    <img
                      src={previewDataUrl}
                      alt="PNG preview"
                      width={gridWidth * exportScale}
                      height={gridHeight * exportScale}
                      style={{ imageRendering: "pixelated" }}
                      className="rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      Generating preview…
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {gridWidth * exportScale} × {gridHeight * exportScale} px
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  Export size
                </span>
                <div className="flex gap-2">
                  {exportScales.map((scale) => {
                    const isSelected = exportScale === scale;
                    return (
                      <button
                        key={`export-scale-${scale}`}
                        type="button"
                        onClick={() => setExportScale(scale)}
                        className={`flex-1 rounded-full border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${
                          isSelected
                            ? "bg-black text-white dark:bg-white dark:text-black"
                            : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {scale}X
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-200">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  File name
                </span>
                <input
                  type="text"
                  value={exportFilename}
                  onChange={(event) => setExportFilename(event.target.value)}
                  placeholder="pixel-art"
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
                />
              </label>
            </div>
          )}
        />
      )}

      {isSettingsDialogOpen && (
        <SettingsModal onClose={handleCloseSettingsDialog} />
      )}

      {isChangelogDialogOpen && (
        <ChangelogModal onClose={handleCloseChangelogDialog} />
      )}

      {isHotkeysDialogOpen && (
        <ActionRequestModal
          title="Hotkeys"
          handleClose={handleCloseHotkeysDialog}
          handleConfirm={handleCloseHotkeysDialog}
          confirmText="Close"
          hideCancelButton
          renderBody={() => (
            <ul className="flex flex-col gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              {hotkeys.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-4">
                  <span className="font-medium">{item.label}</span>
                  <span className="rounded bg-zinc-100 px-2 py-1 font-mono text-xs uppercase text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                    {item.key}
                  </span>
                </li>
              ))}
            </ul>
          )}
        />
      )}

      {isResetDialogOpen && (
        <ActionRequestModal
          title="Clear Pixel Art?"
          message="This will erase the entire grid. Are you sure you want to continue?"
          handleClose={handleCloseResetDialog}
          handleConfirm={handleConfirmReset}
          confirmText="Yes, clear"
        />
      )}
    </>
  );
}
