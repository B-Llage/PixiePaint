import Image from "next/image";

import { PaintTool } from "./PixelPencilTypes";

interface ToolboxProps {
  tools: readonly PaintTool[];
  selectedToolId: PaintTool["id"];
  onSelect: (toolId: PaintTool["id"]) => void;
}

export function Toolbox({ tools, selectedToolId, onSelect }: ToolboxProps) {
  return (
    <div className="flex flex-wrap justify-center gap-3">
      {tools.map((option) => {
        const isSelected = option.id === selectedToolId;
        return (
          <div key={option.id} className="group relative flex">
            <button
              type="button"
              data-pixel-tool={option.id}
              className={`flex items-center justify-center rounded-full border border-zinc-300 p-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-zinc-700 dark:focus-visible:ring-white dark:focus-visible:ring-offset-black ${
                isSelected
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              }`}
              onClick={() => onSelect(option.id)}
              aria-label={option.label}
              aria-describedby={`tool-tooltip-${option.id}`}
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
            <span
              id={`tool-tooltip-${option.id}`}
              role="tooltip"
              className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-300 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-l border-t border-zinc-300 bg-zinc-900" />
              {option.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
