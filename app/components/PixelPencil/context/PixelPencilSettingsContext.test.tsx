import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PixelPencilSettingsProvider, usePixelPencilSettings } from "./PixelPencilSettingsContext";
import { SettingsModal } from "../Settings/SettingsModal";

function SettingsProbe() {
  const settings = usePixelPencilSettings();
  return (
    <>
      <output data-testid="settings">
        {JSON.stringify({
          previewToolEffects: settings.previewToolEffects,
          dimStrokePreview: settings.dimStrokePreview,
          canvasPixelSize: settings.canvasPixelSize,
          gridWidth: settings.gridWidth,
          gridHeight: settings.gridHeight,
          showPixelGrid: settings.showPixelGrid,
          checkerSize: settings.checkerSize,
        })}
      </output>
      <button onClick={() => settings.setGridWidth(64)}>Set width</button>
      <button onClick={() => settings.setDimStrokePreview(true)}>Dim strokes</button>
    </>
  );
}

function readSettings() {
  return JSON.parse(screen.getByTestId("settings").textContent ?? "{}") as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

describe("PixelPencilSettingsProvider", () => {
  it("offers the old dimmed stroke appearance as an opt-in setting", async () => {
    render(<PixelPencilSettingsProvider><SettingsModal handleCloseSettingsDialog={vi.fn()} /></PixelPencilSettingsProvider>);

    const checkbox = screen.getByRole("checkbox", { name: /Dim Stroke Preview/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}").dimStrokePreview).toBe(true));
  });

  it("hydrates saved values before writing settings back", async () => {
    const saved = {
      previewToolEffects: false,
      dimStrokePreview: true,
      canvasPixelSize: 19,
      gridWidth: 64,
      gridHeight: 16,
      showPixelGrid: true,
      checkerSize: 3,
    };
    window.localStorage.setItem("pixel-pencil-settings", JSON.stringify(saved));
    const write = vi.spyOn(Storage.prototype, "setItem");

    render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);

    expect(write).not.toHaveBeenCalled();
    await waitFor(() => expect(readSettings()).toEqual(saved));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}")).toEqual(saved));
    expect(write).toHaveBeenCalledWith("pixel-pencil-settings", JSON.stringify(saved));
  });

  it("rejects unsupported values and persists valid changes", async () => {
    window.localStorage.setItem("pixel-pencil-settings", JSON.stringify({
      gridWidth: 999,
      gridHeight: 16,
      checkerSize: 0,
      showPixelGrid: "yes",
      dimStrokePreview: "yes",
    }));

    render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);

    await waitFor(() => expect(readSettings()).toMatchObject({
      gridWidth: 32,
      gridHeight: 16,
      checkerSize: 8,
      showPixelGrid: false,
      dimStrokePreview: false,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Set width" }));
    await waitFor(() => expect(readSettings().gridWidth).toBe(64));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}").gridWidth).toBe(64));
    fireEvent.click(screen.getByRole("button", { name: "Dim strokes" }));
    await waitFor(() => expect(readSettings().dimStrokePreview).toBe(true));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}").dimStrokePreview).toBe(true));
  });

  it("recovers from malformed stored JSON", async () => {
    window.localStorage.setItem("pixel-pencil-settings", "{broken");

    render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);

    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}")).toMatchObject({
      gridWidth: 32,
      gridHeight: 32,
      checkerSize: 8,
      dimStrokePreview: false,
    }));
  });
});
