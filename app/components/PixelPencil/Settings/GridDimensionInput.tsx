"use client";

import { useState, type KeyboardEvent } from "react";

import {
  MAX_GRID_DIMENSION,
  MIN_GRID_DIMENSION,
} from "../PixelPencil.constants";
import { clampGridDimension } from "../context/PixelPencilSettingsContext";

interface GridDimensionInputProps {
  label: "Grid Width" | "Grid Height";
  value: number;
  onCommit: (value: number) => void;
}

export const GRID_DIMENSION_RANGE_MESSAGE = `Enter a whole number from ${MIN_GRID_DIMENSION} to ${MAX_GRID_DIMENSION}`;

export function GridDimensionInput({
  label,
  value,
  onCommit,
}: GridDimensionInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const commit = () => {
    if (draft === null) return;
    const parsed = draft.trim() === "" ? NaN : Number(draft);
    const next = clampGridDimension(parsed);
    if (next === null) {
      setInvalid(true);
    } else {
      setInvalid(false);
      if (next !== value) onCommit(next);
    }
    setDraft(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={`grid-dimension-${label}`}
        className="text-sm font-medium text-zinc-900 dark:text-zinc-50"
      >
        {label}
      </label>
      <input
        id={`grid-dimension-${label}`}
        type="number"
        inputMode="numeric"
        min={MIN_GRID_DIMENSION}
        max={MAX_GRID_DIMENSION}
        step={1}
        aria-label={label}
        aria-invalid={invalid}
        value={draft ?? String(value)}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="w-32 rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus-visible:ring-white"
      />
      {invalid ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {GRID_DIMENSION_RANGE_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
