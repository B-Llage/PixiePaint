"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { PaintTool } from "./PixelPencilTypes";

interface ToolboxProps {
  tools: readonly PaintTool[];
  selectedToolId: PaintTool["id"];
  onSelect: (toolId: PaintTool["id"]) => void;
}

export function Toolbox({ tools, selectedToolId, onSelect }: ToolboxProps) {
  const [tooltip, setTooltip] = useState<{
    id: PaintTool["id"];
    label: string;
    left: number;
    top: number;
  } | null>(null);

  const showTooltip = (button: HTMLButtonElement, option: PaintTool) => {
    const bounds = button.getBoundingClientRect();
    setTooltip({
      id: option.id,
      label: option.label,
      left: Math.max(48, Math.min(window.innerWidth - 48, bounds.left + bounds.width / 2)),
      top: bounds.top - 8,
    });
  };

  useEffect(() => {
    if (!tooltip) return;
    const hideTooltip = () => setTooltip(null);
    document.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
    return () => {
      document.removeEventListener("scroll", hideTooltip, true);
      window.removeEventListener("resize", hideTooltip);
    };
  }, [tooltip]);

  return (
    <>
      <div className="flex w-max min-w-full flex-nowrap justify-center gap-3">
        {tools.map((option) => {
          const isSelected = option.id === selectedToolId;
          return (
            <div key={option.id} className="flex shrink-0">
              <button
                type="button"
                data-pixel-tool={option.id}
                className={`flex items-center justify-center rounded-full border border-zinc-300 p-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${
                  isSelected
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                }`}
                onClick={() => onSelect(option.id)}
                onMouseEnter={(event) => showTooltip(event.currentTarget, option)}
                onMouseLeave={(event) => {
                  if (document.activeElement !== event.currentTarget) setTooltip(null);
                }}
                onFocus={(event) => showTooltip(event.currentTarget, option)}
                onBlur={() => setTooltip(null)}
                aria-label={option.label}
                aria-describedby={tooltip?.id === option.id ? `tool-tooltip-${option.id}` : undefined}
              >
                <Image
                  src={option.icon}
                  width={32}
                  height={32}
                  alt={`${option.label} icon`}
                  unoptimized
                  style={{ imageRendering: "pixelated" }}
                />
              </button>
            </div>
          );
        })}
      </div>
      {tooltip && createPortal(
        <div
          id={`tool-tooltip-${tooltip.id}`}
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-zinc-300 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-100 shadow-lg"
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          {tooltip.label}
          <span
            aria-hidden="true"
            className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-zinc-300 bg-zinc-900"
          />
        </div>,
        document.body,
      )}
    </>
  );
}
