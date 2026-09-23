import { useEffect, useRef, useState } from "react";

import { MAX_BRUSH_SIZE } from "../../PixelPencil.constants";

interface BrushSizeSelectorProps {
    value: number;
    onChange: (size: number) => void;
    onDragChange: (dragging: boolean) => void;
}

const PIXELS_PER_SIZE_STEP = 8;

export function BrushSizeSelector({ value, onChange, onDragChange }: BrushSizeSelectorProps) {
    const [draft, setDraft] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const drag = useRef<{ pointerId: number; startY: number; startSize: number; lastSize: number; didDrag: boolean } | null>(null);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const current = drag.current;
            if (!current || event.pointerId !== current.pointerId) return;

            const steps = Math.trunc((current.startY - event.clientY) / PIXELS_PER_SIZE_STEP);
            if (steps === 0) return;
            event.preventDefault();
            if (!current.didDrag) {
                current.didDrag = true;
                onDragChange(true);
            }
            inputRef.current?.blur();
            const nextSize = Math.max(1, Math.min(MAX_BRUSH_SIZE, current.startSize + steps));
            if (nextSize === current.lastSize) return;
            current.lastSize = nextSize;
            setDraft(null);
            onChange(nextSize);
        };
        const endDrag = (event: PointerEvent) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            if (drag.current.didDrag) {
                inputRef.current?.blur();
                onDragChange(false);
            }
            drag.current = null;
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        return () => {
            if (drag.current?.didDrag) onDragChange(false);
            drag.current = null;
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", endDrag);
            window.removeEventListener("pointercancel", endDrag);
        };
    }, [onChange, onDragChange]);

    return (
        <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs font-medium text-zinc-300">
            Brush Size
            <input
                ref={inputRef}
                data-brush-size-input
                type="number"
                min={1}
                max={MAX_BRUSH_SIZE}
                step={1}
                title={`Type a size or drag up/down (1–${MAX_BRUSH_SIZE} px)`}
                value={draft ?? value}
                style={{ colorScheme: "dark" }}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    drag.current = {
                        pointerId: event.pointerId,
                        startY: event.clientY,
                        startSize: value,
                        lastSize: value,
                        didDrag: false,
                    };
                }}
                onChange={(event) => {
                    const next = event.target.value;
                    setDraft(next);
                    const size = Number(next);
                    if (next !== "" && Number.isInteger(size) && size >= 1 && size <= MAX_BRUSH_SIZE) {
                        onChange(size);
                    }
                }}
                onBlur={() => setDraft(null)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="h-8 w-16 touch-none cursor-ns-resize rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-center text-xs text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            />
            <span aria-hidden="true">px</span>
        </label>
    );
}
