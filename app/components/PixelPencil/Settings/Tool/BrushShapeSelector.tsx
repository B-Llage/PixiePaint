import type { Dispatch, SetStateAction } from "react";
import { BrushShape } from "../../PixelPencilTypes";


interface BrushShapeOption {
    id: BrushShape;
    label: string;
}

interface BrushShapeSelectorProps {
    options: readonly BrushShapeOption[];
    value: BrushShape;
    onChange: Dispatch<SetStateAction<BrushShape>>;
}

export function BrushShapeSelector({ options, value, onChange }: BrushShapeSelectorProps) {
    return (
        <div className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="text-xs font-medium text-zinc-300">
                Brush Shape
            </span>
            <div className="flex gap-1.5">
                {options.map((shape) => {
                    const isSelected = shape.id === value;
                    return (
                        <button
                            key={shape.id}
                            type="button"
                            className={`h-8 rounded-full border border-zinc-300 px-3 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${isSelected
                                ? "bg-black text-white dark:bg-white dark:text-black"
                                : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                }`}
                            onClick={() => onChange(shape.id)}
                        >
                            {shape.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
