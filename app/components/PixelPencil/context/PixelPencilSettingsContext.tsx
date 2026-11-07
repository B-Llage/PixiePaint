"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useCallback,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  DEFAULT_GRID_DIMENSION,
  MAX_GRID_DIMENSION,
  MIN_GRID_DIMENSION,
} from "../PixelPencil.constants";

type CanvasPixelSizeOption = 8 | 13 | 16 | 19 | 32;
type CheckerSizeOption = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface PixelPencilSettingsContextValue {
  previewToolEffects: boolean;
  setPreviewToolEffects: Dispatch<SetStateAction<boolean>>;
  dimStrokePreview: boolean;
  setDimStrokePreview: Dispatch<SetStateAction<boolean>>;
  useToolAsMousePointer: boolean;
  setUseToolAsMousePointer: Dispatch<SetStateAction<boolean>>;
  canvasPixelSize: CanvasPixelSizeOption;
  setCanvasPixelSize: Dispatch<SetStateAction<CanvasPixelSizeOption>>;
  gridWidth: number;
  gridHeight: number;
  setGridWidth: (value: number) => void;
  setGridHeight: (value: number) => void;
  showPixelGrid: boolean;
  setShowPixelGrid: Dispatch<SetStateAction<boolean>>;
  checkerSize: CheckerSizeOption;
  setCheckerSize: Dispatch<SetStateAction<CheckerSizeOption>>;
}

const STORAGE_KEY = "pixel-pencil-settings";

export function clampGridDimension(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < MIN_GRID_DIMENSION ||
    value > MAX_GRID_DIMENSION
  ) {
    return null;
  }
  return value;
}

const PixelPencilSettingsContext =
  createContext<PixelPencilSettingsContextValue | null>(null);

export function PixelPencilSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [previewToolEffects, setPreviewToolEffects] = useState(true);
  const [dimStrokePreview, setDimStrokePreview] = useState(false);
  const [useToolAsMousePointer, setUseToolAsMousePointer] = useState(false);
  const [canvasPixelSize, setCanvasPixelSize] =
    useState<CanvasPixelSizeOption>(8);
  const [gridWidth, setGridWidthState] = useState(DEFAULT_GRID_DIMENSION);
  const [gridHeight, setGridHeightState] = useState(DEFAULT_GRID_DIMENSION);
  const setGridWidth = useCallback((value: number) => {
    const next = clampGridDimension(value);
    if (next !== null) setGridWidthState(next);
  }, []);
  const setGridHeight = useCallback((value: number) => {
    const next = clampGridDimension(value);
    if (next !== null) setGridHeightState(next);
  }, []);
  const [showPixelGrid, setShowPixelGrid] = useState(false);
  const [checkerSize, setCheckerSize] = useState<CheckerSizeOption>(8);

  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<{
          previewToolEffects: boolean;
          dimStrokePreview: boolean;
          useToolAsMousePointer: boolean;
          canvasPixelSize: CanvasPixelSizeOption;
          gridWidth: unknown;
          gridHeight: unknown;
          showPixelGrid: boolean;
          checkerSize: CheckerSizeOption;
        }>;
        if (typeof parsed.previewToolEffects === "boolean") {
          setPreviewToolEffects(parsed.previewToolEffects);
        }
        if (typeof parsed.dimStrokePreview === "boolean") {
          setDimStrokePreview(parsed.dimStrokePreview);
        }
        if (typeof parsed.useToolAsMousePointer === "boolean") {
          setUseToolAsMousePointer(parsed.useToolAsMousePointer);
        }
        if (
          parsed.canvasPixelSize &&
          (CANVAS_PIXEL_SIZE_OPTIONS as readonly number[]).includes(
            parsed.canvasPixelSize,
          )
        ) {
          setCanvasPixelSize(parsed.canvasPixelSize);
        }
        setGridWidthState(
          clampGridDimension(parsed.gridWidth) ?? DEFAULT_GRID_DIMENSION,
        );
        setGridHeightState(
          clampGridDimension(parsed.gridHeight) ?? DEFAULT_GRID_DIMENSION,
        );
        if (typeof parsed.showPixelGrid === "boolean") {
          setShowPixelGrid(parsed.showPixelGrid);
        }
        if (
          parsed.checkerSize &&
          (CHECKER_SIZE_OPTIONS as readonly number[]).includes(parsed.checkerSize)
        ) {
          setCheckerSize(parsed.checkerSize);
        }
      } catch {
        // Ignore malformed or unavailable storage.
      } finally {
        setHasHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    const payload = JSON.stringify({
      previewToolEffects,
      dimStrokePreview,
      useToolAsMousePointer,
      canvasPixelSize,
      gridWidth,
      gridHeight,
      showPixelGrid,
      checkerSize,
    });
    window.localStorage.setItem(STORAGE_KEY, payload);
  }, [
    previewToolEffects,
    dimStrokePreview,
    useToolAsMousePointer,
    canvasPixelSize,
    gridWidth,
    gridHeight,
    showPixelGrid,
    checkerSize,
    hasHydrated,
  ]);

  const value = useMemo(
    () => ({
      previewToolEffects,
      setPreviewToolEffects,
      dimStrokePreview,
      setDimStrokePreview,
      useToolAsMousePointer,
      setUseToolAsMousePointer,
      canvasPixelSize,
      setCanvasPixelSize,
      gridWidth,
      gridHeight,
      setGridWidth,
      setGridHeight,
      showPixelGrid,
      setShowPixelGrid,
      checkerSize,
      setCheckerSize,
    }),
    [
      previewToolEffects,
      dimStrokePreview,
      useToolAsMousePointer,
      canvasPixelSize,
      gridWidth,
      gridHeight,
      setGridWidth,
      setGridHeight,
      showPixelGrid,
      checkerSize,
    ],
  );

  return (
    <PixelPencilSettingsContext.Provider value={value}>
      {children}
    </PixelPencilSettingsContext.Provider>
  );
}

export function usePixelPencilSettings() {
  const context = useContext(PixelPencilSettingsContext);
  if (!context) {
    throw new Error(
      "usePixelPencilSettings must be used within a PixelPencilSettingsProvider",
    );
  }
  return context;
}

export const CANVAS_PIXEL_SIZE_OPTIONS: ReadonlyArray<CanvasPixelSizeOption> = [
  8,
  13,
  16,
  19,
  32,
] as const;

export const CHECKER_SIZE_OPTIONS: ReadonlyArray<CheckerSizeOption> = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
] as const;
