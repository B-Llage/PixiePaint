import { RefObject, useMemo } from "react";
import { checkerboardStyle } from "../../checkerboard";
import { PixelValue } from "../../PixelPencilTypes";

interface PaletteProps {
    paletteColors: string[];
    /** The color brushes paint with; its swatch is marked pressed (hex compared case-insensitively). */
    activeColor: string;
    setActiveColor: (color: string) => void;
    drawValueRef: RefObject<PixelValue>
}
export function ColorPalette({ paletteColors, activeColor, setActiveColor, drawValueRef }: PaletteProps) {
    const selectedColor = activeColor.toLowerCase();

    const paletteButtons = useMemo(
        () =>
            paletteColors.map((color) => {
                const isTransparent = color === "transparent";
                const isSelected = color.toLowerCase() === selectedColor;
                return (
                    <button
                        key={color}
                        type="button"
                        aria-label={`Use color ${color}`}
                        aria-pressed={isSelected}
                        className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${isSelected ? "border-zinc-50 ring-2 ring-zinc-50 ring-offset-1 ring-offset-zinc-950" : "border-zinc-300 dark:border-zinc-700"}`}
                        style={{
                            ...(isTransparent ? { backgroundColor: "transparent", ...checkerboardStyle(8) } : { backgroundColor: color }),
                        }}
                        onClick={() => {
                            setActiveColor(color);
                            drawValueRef.current = color;
                        }}
                    />
                );
            }),
        [paletteColors, selectedColor, setActiveColor, drawValueRef],
    );

    return (
        <div>
            <span className="sr-only">
                Palette
            </span>
            <div className="flex flex-wrap gap-1">{paletteButtons}</div>
        </div>
    );
}
