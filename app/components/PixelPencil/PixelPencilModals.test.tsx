import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PixelPencilModals } from "./PixelPencilModals";

vi.mock("./Settings/SettingsModal", () => ({ SettingsModal: () => null }));
vi.mock("./Settings/ChangelogModal", () => ({ ChangelogModal: () => null }));

function renderSaveDialog(exportScales: readonly (1 | 3 | 5 | 10)[]) {
  return render(
    <PixelPencilModals
      isSaveDialogOpen
      handleCloseSaveDialog={() => {}}
      handleConfirmSave={() => {}}
      exportScale={1}
      exportScales={exportScales}
      setExportScale={() => {}}
      exportFilename="pixel-art"
      setExportFilename={() => {}}
      previewDataUrl={null}
      gridWidth={2048}
      gridHeight={2048}
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
});
