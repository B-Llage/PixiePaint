import { useEffect, useRef, useState } from "react";
import { PaletteColor, PaletteTheme, PixelValue } from "../../PixelPencilTypes";
import { PixelPencilPalettes } from "../../PixelPencilPalettes";

const PALETTE_THEMES: readonly PaletteTheme[] = PixelPencilPalettes;
interface PaletteColorSelectorProps {
    paletteThemeId?: string;
    currentPalette: PaletteTheme;
    drawValueRef: React.RefObject<PixelValue>;
    setPaletteThemeId: React.Dispatch<React.SetStateAction<string>>;
    setActiveColor: React.Dispatch<React.SetStateAction<string>>;
}
export function PaletteThemeSelector({ paletteThemeId,  currentPalette, drawValueRef, setPaletteThemeId, setActiveColor, }: PaletteColorSelectorProps) {
    const [isPaletteMenuOpen, setIsPaletteMenuOpen] = useState(false);
    const paletteMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isPaletteMenuOpen) return;
        const handleClickAway = (event: MouseEvent) => {
            if (
                paletteMenuRef.current &&
                !paletteMenuRef.current.contains(event.target as Node)
            ) {
                setIsPaletteMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickAway);
        return () => document.removeEventListener("mousedown", handleClickAway);
    }, [isPaletteMenuOpen]);

    return (
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                Palette Set
            </span>
            <div className="relative w-full" ref={paletteMenuRef}>
                <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-left text-sm font-medium text-zinc-800 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black"
                    onClick={() => setIsPaletteMenuOpen((prev) => !prev)}
                >
                    <span className="me-2">{currentPalette.name}</span>
                    <span className="grid grid-cols-9 gap-px place-items-center">
                        {currentPalette.colors.map((color, index) => {
                            const isTransparent = color === "transparent";
                            return (
                                <span
                                    key={`${currentPalette.id}-${color}-${index}`}
                                    className="h-3 w-3 rounded-sm border border-zinc-200 dark:border-zinc-700"
                                    style={{
                                        backgroundColor: isTransparent ? "transparent" : color,
                                        backgroundImage: isTransparent
                                            ? "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db), linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db)"
                                            : undefined,
                                        backgroundSize: isTransparent ? "8px 8px" : undefined,
                                        backgroundPosition: isTransparent ? "0 0, 4px 4px" : undefined,
                                    }}
                                />
                            );
                        })}
                    </span>
                </button>
                {isPaletteMenuOpen && (
                    <div className="absolute z-10 mt-2 max-h-64 w-full overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                        {PALETTE_THEMES.map((theme) => {
                            const isSelected = theme.id === paletteThemeId;
                            const previewColors = theme.colors;
                            return (
                                <button
                                    key={theme.id}
                                    type="button"
                                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors focus:outline-none ${isSelected
                                        ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                                        : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                        }`}
                                    onClick={() => {
                                        const nextColors = [...theme.colors, "transparent"] as PaletteColor[];
                                        setPaletteThemeId(theme.id);
                                        setActiveColor((current) => {
                                            const nextColor = nextColors.includes(current)
                                                ? current
                                                : nextColors[0];
                                            drawValueRef.current = nextColor;
                                            return nextColor;
                                        });
                                        setIsPaletteMenuOpen(false);
                                    }}
                                >
                                    <span className="font-medium">{theme.name}</span>
                                    <span className="grid grid-cols-9 gap-px place-items-center">
                                        {previewColors.map((color, index) => {
                                            const isTransparent = color === "transparent";
                                            return (
                                                <span
                                                    key={`${theme.id}-preview-${color}-${index}`}
                                                    className="h-3 w-3 rounded-sm border border-zinc-200 dark:border-zinc-700"
                                                    style={{
                                                        backgroundColor: isTransparent ? "transparent" : color,
                                                        backgroundImage: isTransparent
                                                            ? "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db), linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db)"
                                                            : undefined,
                                                        backgroundSize: isTransparent ? "8px 8px" : undefined,
                                                        backgroundPosition: isTransparent ? "0 0, 4px 4px" : undefined,
                                                    }}
                                                />
                                            );
                                        })}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
