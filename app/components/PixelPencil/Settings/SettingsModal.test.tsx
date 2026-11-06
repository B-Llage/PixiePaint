import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PixelPencilSettingsProvider } from "../context/PixelPencilSettingsContext";
import { SettingsModal } from "./SettingsModal";

function renderModal() {
  render(
    <PixelPencilSettingsProvider>
      <SettingsModal onClose={vi.fn()} />
    </PixelPencilSettingsProvider>,
  );
  return {
    width: screen.getByLabelText("Grid Width") as HTMLInputElement,
    height: screen.getByLabelText("Grid Height") as HTMLInputElement,
  };
}

const RANGE_MESSAGE = "Enter a whole number from 1 to 2048";

describe("SettingsModal grid size inputs", () => {
  it("commits a typed grid width on Enter and on blur", () => {
    const { width, height } = renderModal();
    expect(width.value).toBe("32");

    fireEvent.change(width, { target: { value: "100" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(width.value).toBe("100");

    fireEvent.change(height, { target: { value: "7" } });
    fireEvent.blur(height);
    expect(height.value).toBe("7");
    expect(screen.queryByText(RANGE_MESSAGE)).toBeNull();
  });

  it("reverts an invalid grid height and shows the range message", () => {
    const { height } = renderModal();
    for (const bad of ["", "0", "2049", "3.5"]) {
      fireEvent.change(height, { target: { value: bad } });
      fireEvent.blur(height);
      expect(height.value).toBe("32");
      expect(screen.getByText(RANGE_MESSAGE)).toBeTruthy();
      fireEvent.change(height, { target: { value: "16" } });
      fireEvent.blur(height);
      expect(screen.queryByText(RANGE_MESSAGE)).toBeNull();
      fireEvent.change(height, { target: { value: "32" } });
      fireEvent.blur(height);
    }
  });

  it("ties the validation message to its input with aria-describedby", () => {
    const { height, width } = renderModal();
    expect(height.getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(height, { target: { value: "0" } });
    fireEvent.blur(height);
    const message = screen.getByText(RANGE_MESSAGE);
    expect(message.id).not.toBe("");
    expect(height.getAttribute("aria-describedby")).toBe(message.id);
    expect(width.getAttribute("aria-describedby")).toBeNull();
    expect(height.id).not.toMatch(/\s/);
    expect(height.id).not.toBe(width.id);
  });

  it("warns above 1024", () => {
    const { width } = renderModal();
    const warning = "Very large canvases need a desktop browser.";
    expect(screen.queryByText(warning)).toBeNull();
    fireEvent.change(width, { target: { value: "1024" } });
    fireEvent.blur(width);
    expect(screen.queryByText(warning)).toBeNull();
    fireEvent.change(width, { target: { value: "1025" } });
    fireEvent.blur(width);
    expect(screen.getByText(warning)).toBeTruthy();
  });
});
