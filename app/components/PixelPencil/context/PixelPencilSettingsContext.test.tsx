import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clampGridDimension, PixelPencilSettingsProvider, usePixelPencilSettings } from "./PixelPencilSettingsContext";
import { SettingsModal } from "../Settings/SettingsModal";

function SettingsProbe() {
  const settings = usePixelPencilSettings();
  return (
    <>
      <output data-testid="settings">
        {JSON.stringify({
          previewToolEffects: settings.previewToolEffects,
          dimStrokePreview: settings.dimStrokePreview,
          useToolAsMousePointer: settings.useToolAsMousePointer,
          canvasPixelSize: settings.canvasPixelSize,
          gridWidth: settings.gridWidth,
          gridHeight: settings.gridHeight,
          showPixelGrid: settings.showPixelGrid,
          checkerSize: settings.checkerSize,
        })}
      </output>
      <button onClick={() => settings.setGridWidth(64)}>Set width</button>
      <button onClick={() => settings.setGridWidth(5000)}>Set huge width</button>
      <button onClick={() => settings.setGridWidth(2.5)}>Set fractional width</button>
      <button onClick={() => settings.setDimStrokePreview(true)}>Dim strokes</button>
    </>
  );
}

function readSettings() {
  return JSON.parse(screen.getByTestId("settings").textContent ?? "{}") as Record<string, unknown>;
}

afterEach(() => vi.restoreAllMocks());

describe("PixelPencilSettingsProvider", () => {
  it("keeps the usual pointer by default and persists the tool pointer toggle", async () => {
    render(<PixelPencilSettingsProvider><SettingsModal onClose={vi.fn()} /></PixelPencilSettingsProvider>);

    const checkbox = screen.getByRole("checkbox", { name: /Use Tool as Mouse Pointer/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}").useToolAsMousePointer).toBe(true));
  });

  it("offers the old dimmed stroke appearance as an opt-in setting", async () => {
    render(<PixelPencilSettingsProvider><SettingsModal onClose={vi.fn()} /></PixelPencilSettingsProvider>);

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
      useToolAsMousePointer: true,
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
      gridWidth: 4096,
      gridHeight: 16,
      checkerSize: 0,
      showPixelGrid: "yes",
      dimStrokePreview: "yes",
      useToolAsMousePointer: "yes",
    }));

    render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);

    await waitFor(() => expect(readSettings()).toMatchObject({
      gridWidth: 32,
      gridHeight: 16,
      checkerSize: 8,
      showPixelGrid: false,
      dimStrokePreview: false,
      useToolAsMousePointer: false,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Set width" }));
    await waitFor(() => expect(readSettings().gridWidth).toBe(64));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}").gridWidth).toBe(64));
    fireEvent.click(screen.getByRole("button", { name: "Dim strokes" }));
    await waitFor(() => expect(readSettings().dimStrokePreview).toBe(true));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("pixel-pencil-settings") ?? "{}").dimStrokePreview).toBe(true));
  });

  it("hydrates any integer grid size from 1 to 2048 and falls back to 32 otherwise", async () => {
    window.localStorage.setItem("pixel-pencil-settings", JSON.stringify({ gridWidth: 2000, gridHeight: 4096 }));
    const first = render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);
    await waitFor(() => expect(readSettings()).toMatchObject({ gridWidth: 2000, gridHeight: 32 }));
    first.unmount();

    window.localStorage.setItem("pixel-pencil-settings", JSON.stringify({ gridWidth: "abc", gridHeight: 1 }));
    render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);
    await waitFor(() => expect(readSettings()).toMatchObject({ gridWidth: 32, gridHeight: 1 }));
  });

  it("clamps setGridWidth to the allowed range", async () => {
    render(<PixelPencilSettingsProvider><SettingsProbe /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Set width" }));
    await waitFor(() => expect(readSettings().gridWidth).toBe(64));
    fireEvent.click(screen.getByRole("button", { name: "Set huge width" }));
    fireEvent.click(screen.getByRole("button", { name: "Set fractional width" }));
    expect(readSettings().gridWidth).toBe(64);
  });

  it("clampGridDimension accepts only integers within range", () => {
    expect(clampGridDimension(1)).toBe(1);
    expect(clampGridDimension(2048)).toBe(2048);
    expect(clampGridDimension(0)).toBeNull();
    expect(clampGridDimension(2049)).toBeNull();
    expect(clampGridDimension(3.5)).toBeNull();
    expect(clampGridDimension("32")).toBeNull();
    expect(clampGridDimension(NaN)).toBeNull();
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
