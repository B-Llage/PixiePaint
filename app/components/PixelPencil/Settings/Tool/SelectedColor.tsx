import { MutableRefObject, useState } from "react";

import { PaletteColor, PixelValue } from "../../PixelPencilTypes";

export interface SelectedColorStyles {
  backgroundColor: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
}

interface SelectedColorProps {
  selectedColorStyles: SelectedColorStyles;
  activeColor: PaletteColor;
  setActiveColor: (color: PaletteColor) => void;
  drawValueRef: MutableRefObject<PixelValue>;
}

interface HslColor {
  hue: number;
  saturation: number;
  lightness: number;
}

function hexToHsl(color: string): HslColor | null {
  const match = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (!match) return null;

  const hex = match[1].length === 3
    ? [...match[1]].map((digit) => digit + digit).join("")
    : match[1];
  const [red, green, blue] = [0, 2, 4].map((index) =>
    parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const difference = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;

  if (difference > 0) {
    if (maximum === red) hue = ((green - blue) / difference) % 6;
    else if (maximum === green) hue = (blue - red) / difference + 2;
    else hue = (red - green) / difference + 4;
    hue = (hue * 60 + 360) % 360;
  }

  return {
    hue,
    saturation: difference === 0 ? 0 : difference / (1 - Math.abs(2 * lightness - 1)),
    lightness,
  };
}

function hslToHex({ hue, saturation, lightness }: HslColor): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const offset = lightness - chroma / 2;
  const channels = sector < 1 ? [chroma, secondary, 0]
    : sector < 2 ? [secondary, chroma, 0]
    : sector < 3 ? [0, chroma, secondary]
    : sector < 4 ? [0, secondary, chroma]
    : sector < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];

  return `#${channels.map((channel) =>
    Math.round((channel + offset) * 255).toString(16).padStart(2, "0"),
  ).join("")}`;
}

const DEFAULT_COLOR: HslColor = { hue: 0, saturation: 1, lightness: 0.5 };

export function SelectedColor({
  selectedColorStyles,
  activeColor,
  setActiveColor,
  drawValueRef,
}: SelectedColorProps) {
  const [customSelection, setCustomSelection] = useState<{ color: string; hsl: HslColor } | null>(null);
  const hsl = activeColor === customSelection?.color
    ? customSelection.hsl
    : hexToHsl(activeColor) ?? DEFAULT_COLOR;

  const updateColor = (next: HslColor) => {
    const color = hslToHex(next);
    setCustomSelection({ color, hsl: next });
    setActiveColor(color);
    drawValueRef.current = color;
  };

  const handleHueChange = (hue: number) => {
    const current = hsl;
    updateColor({
      hue,
      saturation: current.saturation === 0 ? 1 : current.saturation,
      lightness: current.lightness === 0 || current.lightness === 1 ? 0.5 : current.lightness,
    });
  };

  const handleSaturationChange = (saturation: number) => {
    updateColor({ ...hsl, saturation: saturation / 100 });
  };

  const handleLightnessChange = (lightness: number) => {
    updateColor({ ...hsl, lightness: lightness / 100 });
  };

  return (
    <div className="flex items-center gap-3">
      <style>{`
        .color-slider {
          appearance: none;
          height: 0.75rem;
          border: 1px solid #a1a1aa;
          border-radius: 9999px;
        }
        .color-slider::-webkit-slider-runnable-track,
        .color-slider::-moz-range-track {
          height: 0.75rem;
          border-radius: 9999px;
          background: transparent;
        }
        .color-slider::-webkit-slider-thumb {
          appearance: none;
          width: 1.25rem;
          height: 1.25rem;
          border: 2px solid #fff;
          border-radius: 50%;
          background: #27272a;
          box-shadow: 0 0 0 1px #52525b;
        }
        .color-slider::-moz-range-thumb {
          width: 1rem;
          height: 1rem;
          border: 2px solid #fff;
          border-radius: 50%;
          background: #27272a;
          box-shadow: 0 0 0 1px #52525b;
        }
        .color-slider:focus-visible {
          outline: 2px solid #52525b;
          outline-offset: 3px;
        }
      `}</style>
      <span className="sr-only">Selected Color</span>
      <span
        className="h-12 w-12 shrink-0 rounded-md border border-zinc-300 shadow-inner dark:border-zinc-600"
        style={selectedColorStyles}
        aria-label="Selected color preview"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <label className="block h-5">
          <span className="sr-only">Hue</span>
          <input
            type="range"
            min="0"
            max="359"
            value={Math.round(hsl.hue)}
            onChange={(event) => handleHueChange(Number(event.target.value))}
            className="color-slider w-full cursor-pointer"
            style={{ background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
            aria-label="Hue"
          />
        </label>
        <label className="block h-5">
          <span className="sr-only">Saturation</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(hsl.saturation * 100)}
            onChange={(event) => handleSaturationChange(Number(event.target.value))}
            className="color-slider w-full cursor-pointer"
            style={{ background: `linear-gradient(to right, ${hslToHex({ ...hsl, saturation: 0 })}, ${hslToHex({ ...hsl, saturation: 1 })})` }}
            aria-label="Saturation"
          />
        </label>
        <label className="block h-5">
          <span className="sr-only">Lightness</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(hsl.lightness * 100)}
            onChange={(event) => handleLightnessChange(Number(event.target.value))}
            className="color-slider w-full cursor-pointer"
            style={{ background: `linear-gradient(to right, #000, ${hslToHex({ ...hsl, lightness: 0.5 })}, #fff)` }}
            aria-label="Lightness"
          />
        </label>
      </div>
    </div>
  );
}
