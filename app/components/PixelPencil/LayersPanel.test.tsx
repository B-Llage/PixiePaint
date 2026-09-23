import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LayersPanel } from "./LayersPanel";

function renderPanel() {
  const actions = {
    onSelectLayer: vi.fn(),
    onCreateLayer: vi.fn(),
    onDeleteLayer: vi.fn(),
    onRenameLayer: vi.fn(),
    onToggleVisibility: vi.fn(),
    onReorderLayers: vi.fn(),
  };
  render(
    <LayersPanel
      layers={[
        { id: "bottom", name: "Background", visible: true },
        { id: "top", name: "Highlights", visible: true },
      ]}
      activeLayerId="top"
      layerPreviews={{}}
      {...actions}
    />,
  );
  return actions;
}

describe("LayersPanel", () => {
  it("creates, selects, hides, and deletes layers through its controls", () => {
    const actions = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Add Layer" }));
    fireEvent.click(screen.getByRole("button", { name: "Select Background" }));
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Hide layer" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete layer" })[0]);

    expect(actions.onCreateLayer).toHaveBeenCalledOnce();
    expect(actions.onSelectLayer).toHaveBeenCalledWith("bottom");
    expect(actions.onToggleVisibility).toHaveBeenCalledWith("top");
    expect(actions.onDeleteLayer).toHaveBeenCalledWith("top");
  });

  it("commits a trimmed rename and ignores an empty name", () => {
    const actions = renderPanel();

    fireEvent.doubleClick(screen.getByRole("button", { name: "Highlights" }));
    const input = screen.getByRole("textbox", { name: "Rename Highlights" });
    fireEvent.change(input, { target: { value: "  Shadows  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.onRenameLayer).toHaveBeenCalledWith("top", "Shadows");

    fireEvent.doubleClick(screen.getByRole("button", { name: "Background" }));
    const secondInput = screen.getByRole("textbox", { name: "Rename Background" });
    fireEvent.change(secondInput, { target: { value: "   " } });
    fireEvent.keyDown(secondInput, { key: "Enter" });
    expect(actions.onRenameLayer).toHaveBeenCalledOnce();
  });

  it("reorders using the underlying bottom-to-top layer indices", () => {
    const actions = renderPanel();
    const items = screen.getAllByRole("listitem");
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "top"),
      effectAllowed: "",
      dropEffect: "",
    };

    fireEvent.dragStart(items[0], { dataTransfer });
    fireEvent.drop(items[1], { dataTransfer });

    expect(actions.onReorderLayers).toHaveBeenCalledWith(1, 0);
  });
});
