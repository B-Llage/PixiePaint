import { RefObject, useMemo } from "react";
import { checkerboardStyle } from "../../checkerboard";
import { PixelValue } from "../../PixelPencilTypes";

interface PaletteProps {
    paletteColors: string[];
    setActiveColor: (color: string) => void;
    drawValueRef: RefObject<PixelValue>
}
export function ColorPalette({ paletteColors, setActiveColor, drawValueRef }: PaletteProps) {

    const paletteButtons = useMemo(
        () =>
            paletteColors.map((color) => {
                const isTransparent = color === "transparent";
                return (
                    <button
                        key={color}
                        type="button"
                        aria-label={`Use color ${color}`}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-300 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
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
        [paletteColors, setActiveColor, drawValueRef],
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
