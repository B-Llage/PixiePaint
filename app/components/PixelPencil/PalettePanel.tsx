import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { ColorPalette } from "./Settings/Tool/ColorPalette";
import { PaletteThemeSelector } from "./Settings/Tool/PaletteThemeSelector";
import { SelectedColor, SelectedColorStyles } from "./Settings/Tool/SelectedColor";
import type { PaletteColor, PaletteTheme, PixelValue } from "./PixelPencilTypes";

interface PalettePanelProps {
  paletteThemeId: string;
  setPaletteThemeId: Dispatch<SetStateAction<string>>;
  currentPalette: PaletteTheme;
  drawValueRef: MutableRefObject<PixelValue>;
  setActiveColor: Dispatch<SetStateAction<PaletteColor>>;
  paletteColors: PaletteColor[];
  activeColor: PaletteColor;
  selectedColorStyles: SelectedColorStyles;
}

export function PalettePanel({
  paletteThemeId,
  setPaletteThemeId,
  currentPalette,
  drawValueRef,
  setActiveColor,
  paletteColors,
  activeColor,
  selectedColorStyles,
}: PalettePanelProps) {
  return (
    <div data-tool-settings className="space-y-3">
      <PaletteThemeSelector
        paletteThemeId={paletteThemeId}
        currentPalette={currentPalette}
        drawValueRef={drawValueRef}
        setPaletteThemeId={setPaletteThemeId}
        setActiveColor={setActiveColor}
      />
      <ColorPalette
        paletteColors={paletteColors}
        setActiveColor={setActiveColor}
        drawValueRef={drawValueRef}
      />
      <SelectedColor
        selectedColorStyles={selectedColorStyles}
        activeColor={activeColor}
        setActiveColor={setActiveColor}
        drawValueRef={drawValueRef}
      />
    </div>
  );
}
