import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PixelPencilModals } from "./PixelPencilModals";

vi.mock("./Settings/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("./Settings/ChangelogModal", () => ({ ChangelogModal: () => null }));

function renderSaveDialog(
  exportScales: readonly (1 | 3 | 5 | 10)[],
  extra: { exportScale?: 1 | 3 | 5 | 10; saveError?: string | null; gridWidth?: number; gridHeight?: number } = {},
) {
  return render(
    <PixelPencilModals
      isSaveDialogOpen
      handleCloseSaveDialog={() => {}}
      handleConfirmSave={() => {}}
      exportScale={extra.exportScale ?? 1}
      exportScales={exportScales}
      setExportScale={() => {}}
      exportFilename="pixel-art"
      setExportFilename={() => {}}
      previewDataUrl={null}
      gridWidth={extra.gridWidth ?? 2048}
      gridHeight={extra.gridHeight ?? 2048}
      saveError={extra.saveError ?? null}
      isSettingsDialogOpen={false}
      handleCloseSettingsDialog={() => {}}
      isChangelogDialogOpen={false}
      handleCloseChangelogDialog={() => {}}
      isHotkeysDialogOpen={false}
      handleCloseHotkeysDialog={() => {}}
      hotkeys={[]}
      isResetDialogOpen={false}
      handleCloseResetDialog={() => {}}
      handleConfirmReset={() => {}}
    />,
  );
}

describe("PixelPencilModals save dialog", () => {
  it("renders only the available export scales", () => {
    renderSaveDialog([1, 3, 5]);
    expect(["1X", "3X", "5X"].map((label) => screen.queryByRole("button", { name: label }) !== null)).toEqual([
      true,
      true,
      true,
    ]);
    expect(screen.queryByRole("button", { name: "10X" })).toBeNull();
  });

  it("captions the real output size, not the bounded preview size", () => {
    renderSaveDialog([1, 3, 5], { exportScale: 5, gridWidth: 2048, gridHeight: 1000 });
    expect(screen.getByText("10240 × 5000 px")).toBeTruthy();
  });

  it("shows the save error under the dialog actions when set", () => {
    renderSaveDialog([1], { saveError: null });
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    renderSaveDialog([1], { saveError: "Could not render the PNG at this size." });
    expect(screen.getByRole("alert").textContent).toBe("Could not render the PNG at this size.");
  });
});
