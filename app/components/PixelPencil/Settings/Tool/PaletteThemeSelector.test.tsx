import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PixelPencilPalettes } from "../../PixelPencilPalettes";
import type { PixelValue } from "../../PixelPencilTypes";
import { PaletteThemeSelector } from "./PaletteThemeSelector";

describe("PaletteThemeSelector", () => {
  it("renders the Palette Set label with light and dark text colors", () => {
    const palette = PixelPencilPalettes[0];
    render(
      <PaletteThemeSelector
        paletteThemeId={palette.id}
        currentPalette={palette}
        drawValueRef={{ current: palette.colors[0] as PixelValue }}
        setPaletteThemeId={vi.fn()}
        setActiveColor={vi.fn()}
      />,
    );

    const label = screen.getByText("Palette Set");
    expect(label.className).toContain("text-zinc-900");
    expect(label.className).toContain("dark:text-zinc-50");
  });
});
