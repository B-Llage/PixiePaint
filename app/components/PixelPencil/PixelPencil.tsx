"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  BrushShape,
  Layer,
  PaletteColor,
  PaletteTheme,
  PixelValue,
  ShapeKind,
  ZoomMode,
} from "./PixelPencilTypes";
import { PencilTool, TOOLS, type ToolId } from "./PixelPencilTools";
import { PixelPencilPalettes } from "./PixelPencilPalettes";
import { CANVAS_PIXEL_SIZE_OPTIONS, usePixelPencilSettings } from "./context/PixelPencilSettingsContext";
import { MIN_CELL_SIZE_DESKTOP } from "./PixelPencil.constants";
import { usePixelExport } from "./hooks/usePixelExport";
import { Toolbox } from "./Toolbox";
import { ToolSettingsPanel } from "./ToolSettingsPanel";
import { PalettePanel } from "./PalettePanel";
import type { SelectedColorStyles } from "./Settings/Tool/SelectedColor";
import { PixelGrid } from "./PixelGrid";
import { PixelPencilModals } from "./PixelPencilModals";
import { LayersPanel } from "./LayersPanel";
import {
  arePixelsEqual,
  cloneLayers,
  cloneSelection,
  composeLayers,
  generateLayerName,
} from "./pixel-operations";
import {
  collectFillRegion,
  computeBrushIndices as computeBrushIndicesOnGrid,
  computeLineIndices as computeLineIndicesOnGrid,
  computeShapeCells as computeShapeCellsOnGrid,
  traceWorldSegment as traceWorldSegmentOnGrid,
} from "./grid-geometry";
import { checkerboardStyle } from "./checkerboard";
import { useEscapeKey } from "./hooks/useEscapeKey";
import { useStateWithRef } from "./hooks/useStateWithRef";
import { useEditorHistory, type LayerSnapshot } from "./hooks/useEditorHistory";
import { useCanvasViewport } from "./hooks/useCanvasViewport";
import { useSelectionGestures, useSelectionState } from "./hooks/useSelection";
import { useMoveDrag } from "./hooks/useMoveDrag";
import packageJson from "../../../package.json";

const PALETTE_THEMES: readonly PaletteTheme[] = PixelPencilPalettes;

const APP_VERSION = packageJson.version;
// Below Tailwind's `md` breakpoint the Layers and Palette panels become bottom sheets.
const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
const LAYER_PREVIEW_MAX_SIZE = 64; // px, longest side of a layer thumbnail
// A 32-cell grid defaults to 16px cells; other grid sizes scale to keep a similar footprint.
const AUTO_CELL_SIZE_REFERENCE_GRID = 32;
const AUTO_CELL_SIZE_REFERENCE_CELL = 16;

const HOTKEY_ITEMS = [
  ...TOOLS.map((item) => ({ label: item.label, key: item.hotkey.toUpperCase() })),
  { label: "Pan Canvas", key: "Two-finger scroll / Middle mouse drag" },
  { label: "Zoom Canvas", key: "Pinch / Mouse wheel / Cmd/Win + Wheel" },
  { label: "Undo", key: "Ctrl/Cmd + Z" },
  { label: "Redo", key: "Ctrl/Cmd + Shift + Z" },
  { label: "Clear", key: "Ctrl/Cmd + Backspace" },
];

const createLayerId = () =>
  `layer-${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36)}`;

export function PixelPencil() {
  const {
    previewToolEffects,
    dimStrokePreview,
    useToolAsMousePointer,
    canvasPixelSize,
    setCanvasPixelSize,
    gridWidth,
    gridHeight,
    showPixelGrid,
    checkerSize,
  } = usePixelPencilSettings();

  const totalCells = gridWidth * gridHeight;
  const createEmptyPixelArray = () =>
    new Array(totalCells).fill(null) as PixelValue[];
  const initialLayerIdRef = useRef<string | null>(null);
  if (!initialLayerIdRef.current) {
    initialLayerIdRef.current = createLayerId();
  }
  const initialLayerPixelsRef = useRef<PixelValue[] | null>(null);
  if (
    !initialLayerPixelsRef.current ||
    initialLayerPixelsRef.current.length !== totalCells
  ) {
    initialLayerPixelsRef.current = createEmptyPixelArray();
  }
  const [layers, setLayers, layersRef] = useStateWithRef<Layer[]>(() => [
    {
      id: initialLayerIdRef.current as string,
      name: "Layer 1",
      pixels: initialLayerPixelsRef.current as PixelValue[],
      visible: true,
    },
  ]);
  const [activeLayerId, setActiveLayerId] = useState<string>(
    initialLayerIdRef.current as string,
  );
  const [activeLayerPixels, setActiveLayerPixelsState, activeLayerPixelsRef] =
    useStateWithRef<PixelValue[]>(
    initialLayerPixelsRef.current as PixelValue[],
  );
  const [compositePixels, setCompositePixels, compositePixelsRef] = useStateWithRef<PixelValue[]>(
    () => createEmptyPixelArray(),
  );
  const [layerPreviews, setLayerPreviews] = useState<Record<string, string>>({});
  const [paletteThemeId, setPaletteThemeId] = useState<
    (typeof PALETTE_THEMES)[number]["id"]
  >(PALETTE_THEMES[0].id);
  const [activeColor, setActiveColor] = useState<PaletteColor>(
    PALETTE_THEMES[0].colors[0],
  );
  const [tool, setTool] = useState<ToolId>("pencil");
  const [autoPickLayer, setAutoPickLayer] = useState(false);
  const [brushSize, setBrushSize] = useState<number>(1);
  const [brushSizeDragging, setBrushSizeDragging] = useState(false);
  const [brushShape, setBrushShape] = useState<BrushShape>("square");
  const [shapeType, setShapeType] = useState<ShapeKind>("square");
  const [shapeFilled, setShapeFilled] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const setHoverIndexIfChanged = useCallback((next: number | null) => {
    setHoverIndex((prev) => (prev === next ? prev : next));
  }, []);
  const [lastPointedIndex, setLastPointedIndex] = useState<number | null>(null);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isChangelogDialogOpen, setIsChangelogDialogOpen] = useState(false);
  const [isHotkeysDialogOpen, setIsHotkeysDialogOpen] = useState(false);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("in");
  const isDrawingRef = useRef(false);
  const drawValueRef = useRef<PixelValue>(PALETTE_THEMES[0].colors[0]);
  const [drawValueVersion, setDrawValueVersion] = useState(0);
  const setDrawValue = useCallback((value: PixelValue) => {
    if (drawValueRef.current === value) {
      return;
    }
    drawValueRef.current = value;
    setDrawValueVersion((prev) => prev + 1);
  }, []);
  const lastPaintedIndexRef = useRef<number | null>(null);
  const strokeWorldPointsRef = useRef<{ x: number; y: number }[] | null>(null);
  const strokeAppliedCellsRef = useRef<Set<number> | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const ignoredCanvasPointerIdRef = useRef<number | null>(null);
  const pointerQueueRef = useRef<{ x: number; y: number }[]>([]);
  const pointerRAFRef = useRef<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [pathPreview, setPathPreview] = useState<Set<number> | null>(null);
  const prevDimensionsRef = useRef({ width: gridWidth, height: gridHeight });
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "palette" | null>(null);
  const mobileLayersButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilePaletteButtonRef = useRef<HTMLButtonElement | null>(null);
  // Writes the active layer's pixels and mirrors them into `layers`. Like the
  // hook setters, a functional `next` runs synchronously against the latest
  // pixels, so callers may read flags set inside the updater.
  const setActiveLayerPixels = useCallback(
    (
      next:
        | PixelValue[]
        | ((previous: PixelValue[]) => PixelValue[] | PixelValue[]),
    ) => {
      const previousPixels = activeLayerPixelsRef.current;
      const resolvedPixels =
        typeof next === "function"
          ? (next as (prev: PixelValue[]) => PixelValue[])(previousPixels)
          : next;
      if (
        previousPixels === resolvedPixels ||
        (previousPixels &&
          resolvedPixels &&
          arePixelsEqual(previousPixels, resolvedPixels))
      ) {
        return;
      }
      setActiveLayerPixelsState(resolvedPixels);

      const currentLayers = layersRef.current;
      const index = currentLayers.findIndex(
        (layer) => layer.id === activeLayerId,
      );
      if (index === -1) {
        return;
      }
      const targetLayer = currentLayers[index];
      if (targetLayer.pixels === resolvedPixels) {
        return;
      }
      const updatedLayers = [...currentLayers];
      updatedLayers[index] = {
        ...targetLayer,
        pixels: resolvedPixels,
      };
      setLayers(updatedLayers);
    },
    [activeLayerId, activeLayerPixelsRef, layersRef, setActiveLayerPixelsState, setLayers],
  );
  const currentPalette = useMemo(() => {
    const found = PALETTE_THEMES.find((theme) => theme.id === paletteThemeId);
    return found ?? PALETTE_THEMES[0];
  }, [paletteThemeId]);

  const currentTool = useMemo(() => {
    const found = TOOLS.find((item) => item.id === tool);
    return found ?? PencilTool;
  }, [tool]);

  const clampCellX = useCallback(
    (value: number) => Math.max(0, Math.min(gridWidth - 1, value)),
    [gridWidth],
  );

  const clampCellY = useCallback(
    (value: number) => Math.max(0, Math.min(gridHeight - 1, value)),
    [gridHeight],
  );

  const coordsToIndex = useCallback(
    (x: number, y: number) => y * gridWidth + x,
    [gridWidth],
  );

  const isInBounds = useCallback(
    (x: number, y: number) => x >= 0 && x < gridWidth && y >= 0 && y < gridHeight,
    [gridHeight, gridWidth],
  );

  const selectionState = useSelectionState({
    gridWidth,
    gridHeight,
    gridRef,
    activeLayerPixelsRef,
    setActiveLayerPixels,
    setPathPreview,
  });
  const {
    selection,
    setSelection,
    selectionRef,
    selectionPreviewRect,
    selectionContainsCell,
    captureSelectionPixels,
    restoreSelection,
  } = selectionState;

  const captureSnapshot = useCallback(
    (): LayerSnapshot => ({
      layers: cloneLayers(layersRef.current, totalCells),
      activeLayerId,
      selection: cloneSelection(selectionRef.current),
    }),
    [activeLayerId, layersRef, selectionRef, totalCells],
  );

  const applySnapshot = useCallback(
    (snapshot: LayerSnapshot) => {
      const restoredLayers = cloneLayers(snapshot.layers, totalCells);
      setLayers(restoredLayers);
      const nextActiveId = restoredLayers.some(
        (layer) => layer.id === snapshot.activeLayerId,
      )
        ? snapshot.activeLayerId
        : restoredLayers[restoredLayers.length - 1]?.id;
      if (nextActiveId) {
        setActiveLayerId(nextActiveId);
      }
      const targetLayer = restoredLayers.find(
        (layer) => layer.id === (nextActiveId ?? snapshot.activeLayerId),
      );
      if (targetLayer) {
        const cloned = targetLayer.pixels.slice();
        setActiveLayerPixelsState(cloned);
      }
      restoreSelection(snapshot.selection);
      setHoverIndexIfChanged(null);
    },
    [
      restoreSelection,
      setActiveLayerPixelsState,
      setHoverIndexIfChanged,
      setLayers,
      totalCells,
    ],
  );

  const {
    canUndo,
    canRedo,
    recordSnapshot,
    commitSnapshot,
    beginAction,
    beginActionWithSnapshot,
    finalizeAction,
    markModified,
    saveStacks,
    restoreStacks,
    clear: clearHistory,
    undo,
    redo,
  } = useEditorHistory({ captureSnapshot, applySnapshot });

  const paletteColors = useMemo(
    () => [...currentPalette.colors, "transparent"] as PaletteColor[],
    [currentPalette],
  );
  const indexToCoords = useCallback(
    (index: number) => ({
      x: index % gridWidth,
      y: Math.floor(index / gridWidth),
    }),
    [gridWidth],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!layers.length || gridWidth <= 0 || gridHeight <= 0) {
      setLayerPreviews({});
      return;
    }
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      const maxDimension = Math.max(gridWidth, gridHeight);
      const scale = Math.max(1, Math.floor(LAYER_PREVIEW_MAX_SIZE / maxDimension));
      const canvas = document.createElement("canvas");
      canvas.width = gridWidth * scale;
      canvas.height = gridHeight * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;

      const checkerSize = Math.max(scale, 2);
      const previews: Record<string, string> = {};

      const drawCheckerboard = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#e4e4e7";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#f4f4f5";
        for (let y = 0; y < canvas.height; y += checkerSize) {
          const offset = (Math.floor(y / checkerSize) % 2) * checkerSize;
          for (let x = offset; x < canvas.width; x += checkerSize * 2) {
            ctx.fillRect(x, y, checkerSize, checkerSize);
          }
        }
      };

      for (const layer of layers) {
        drawCheckerboard();
        ctx.globalAlpha = layer.visible ? 1 : 0.4;
        for (let index = 0; index < layer.pixels.length; index += 1) {
          const color = layer.pixels[index];
          if (color === null || color === "transparent") continue;
          const { x, y } = indexToCoords(index);
          ctx.fillStyle = color;
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
        ctx.globalAlpha = 1;
        previews[layer.id] = canvas.toDataURL("image/png");
      }

      if (!cancelled) {
        setLayerPreviews(previews);
      }
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [gridHeight, gridWidth, indexToCoords, layers]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(MOBILE_MEDIA_QUERY);
    const update = () => {
      setIsMobile(query.matches);
      if (!query.matches) setMobilePanel(null);
    };
    update();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  useEffect(() => {
    const pointerQueue = pointerQueueRef.current;
    return () => {
      pointerQueue.length = 0;
      if (pointerRAFRef.current !== null) {
        window.cancelAnimationFrame(pointerRAFRef.current);
        pointerRAFRef.current = null;
      }
    };
  }, []);

  const {
    isOpen: isSaveDialogOpen,
    open: handleOpenSaveDialog,
    close: handleCloseSaveDialog,
    confirmSave: handleConfirmSave,
    exportScale,
    setExportScale: setExportScaleState,
    exportFilename,
    setExportFilename: setExportFilenameState,
    previewDataUrl,
  } = usePixelExport({
    gridWidth,
    gridHeight,
    pixels: compositePixels,
    indexToCoords,
  });

  const {
    availableWidth,
    availableHeight,
    canvasViewport,
    canvasScroll,
    displayCellSize,
    contentWidth,
    contentHeight,
    renderOffsetX,
    renderOffsetY,
    scrollOriginX,
    scrollOriginY,
    setCanvasScroll: setCanvasScrollLimited,
    handleViewportResize,
    resolvePositionFromClientPoint,
    zoomAtClientPoint,
    handleWheelZoom,
  } = useCanvasViewport({
    gridWidth,
    gridHeight,
    canvasPixelSize,
    isMobile,
    gridWrapperRef,
    gridRef,
  });

  useEffect(() => {
    const currentLayer = layers.find((layer) => layer.id === activeLayerId);
    if (!currentLayer) return;
    const currentPixels = activeLayerPixelsRef.current;
    if (
      currentPixels === currentLayer.pixels ||
      !currentPixels ||
      !arePixelsEqual(currentPixels, currentLayer.pixels)
    ) {
      const cloned = currentLayer.pixels.slice();
      setActiveLayerPixelsState(cloned);
    }
  }, [activeLayerId, activeLayerPixelsRef, layers, setActiveLayerPixelsState]);

  useEffect(() => {
    const composed = composeLayers(layers, totalCells);
    setCompositePixels(composed);
  }, [layers, setCompositePixels, totalCells]);

  useEffect(() => {
    const prev = prevDimensionsRef.current;
    if (prev.width === gridWidth && prev.height === gridHeight) {
      return;
    }

    const copyWidth = Math.min(prev.width, gridWidth);
    const copyHeight = Math.min(prev.height, gridHeight);

    setLayers((prevLayers) => {
      const nextLayers = prevLayers.map((layer) => {
        const nextPixels = new Array(totalCells).fill(null) as PixelValue[];
        for (let y = 0; y < copyHeight; y += 1) {
          for (let x = 0; x < copyWidth; x += 1) {
            const oldIndex = y * prev.width + x;
            const newIndex = y * gridWidth + x;
            nextPixels[newIndex] = layer.pixels[oldIndex] ?? null;
          }
        }
        return {
          ...layer,
          pixels: nextPixels,
        };
      });
      const activeLayer = nextLayers.find(
        (layer) => layer.id === activeLayerId,
      );
      if (activeLayer) {
        const cloned = activeLayer.pixels.slice();
        setActiveLayerPixelsState(cloned);
      }
      return nextLayers;
    });

    prevDimensionsRef.current = { width: gridWidth, height: gridHeight };
    clearHistory();
    setHoverIndexIfChanged(null);
  }, [
    activeLayerId,
    clearHistory,
    gridHeight,
    gridWidth,
    setActiveLayerPixelsState,
    setHoverIndexIfChanged,
    setLayers,
    totalCells,
  ]);

  // Choosing a new grid size resets the persisted canvas pixel size to the
  // closest option that keeps the artwork at a similar on-screen size.
  useEffect(() => {
    const largestDimension = Math.max(gridWidth, gridHeight);
    const targetSize = Math.max(
      MIN_CELL_SIZE_DESKTOP,
      Math.round((AUTO_CELL_SIZE_REFERENCE_GRID / largestDimension) * AUTO_CELL_SIZE_REFERENCE_CELL),
    );
    let closest = CANVAS_PIXEL_SIZE_OPTIONS[0];
    let smallestDiff = Math.abs(closest - targetSize);
    for (const option of CANVAS_PIXEL_SIZE_OPTIONS) {
      const diff = Math.abs(option - targetSize);
      if (diff < smallestDiff) {
        closest = option;
        smallestDiff = diff;
      }
    }
    setCanvasPixelSize((prev) => (prev === closest ? prev : closest));
  }, [gridHeight, gridWidth, setCanvasPixelSize]);

  useEffect(() => {
    if (tool !== "line" && tool !== "shape") {
      setDragStartIndex(null);
      setPathPreview(null);
      activePointerIdRef.current = null;
      isDrawingRef.current = false;
      lastPaintedIndexRef.current = null;
    }
  }, [tool]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key !== "z") return;
      const isModifier = event.metaKey || event.ctrlKey;
      if (!isModifier) return;

      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      event.preventDefault();

      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [redo, undo]);

  const handleOpenResetDialog = useCallback(() => {
    setIsResetDialogOpen(true);
  }, []);

  useEffect(() => {
    const handleToolHotkeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (
        isSettingsDialogOpen ||
        isChangelogDialogOpen ||
        isResetDialogOpen ||
        isHotkeysDialogOpen
      ) {
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || activeElement.isContentEditable)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "backspace") {
        event.preventDefault();
        handleOpenResetDialog();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      const match = TOOLS.find((item) => item.hotkey === key);
      if (!match) return;
      event.preventDefault();
      setTool(match.id);
    };
    window.addEventListener("keydown", handleToolHotkeys);
    return () => window.removeEventListener("keydown", handleToolHotkeys);
  }, [
    handleOpenResetDialog,
    isChangelogDialogOpen,
    isHotkeysDialogOpen,
    isResetDialogOpen,
    isSettingsDialogOpen,
    setTool,
  ]);

  const computeBrushIndices = useCallback(
    (centerIndex: number) =>
      computeBrushIndicesOnGrid({ width: gridWidth, height: gridHeight }, centerIndex, brushSize, brushShape),
    [brushShape, brushSize, gridHeight, gridWidth],
  );

  const applyBrush = useCallback(
    (index: number, value: PixelValue) => {
      const indices = computeBrushIndices(index);
      if (indices.length === 0) return;

      let changed = false;
      setActiveLayerPixels((prev) => {
        const next = [...prev];

        for (const target of indices) {
          if (next[target] === value) continue;
          next[target] = value;
          changed = true;
        }

        if (!changed) {
          return prev;
        }

        return next;
      });

      if (changed) {
        markModified();
      }
    },
    [computeBrushIndices, markModified, setActiveLayerPixels],
  );

  const applyLinePath = useCallback(
    (path: number[], value: PixelValue) => {
      if (!path.length) return;
      const current = activeLayerPixelsRef.current;
      const next = [...current];
      let changed = false;

      for (const pathIndex of path) {
        const indices = computeBrushIndices(pathIndex);
        for (const target of indices) {
          if (next[target] === value) continue;
          next[target] = value;
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      markModified();
      setActiveLayerPixels(next);
    },
    [activeLayerPixelsRef, computeBrushIndices, markModified, setActiveLayerPixels],
  );

  const buildLinePreview = useCallback(
    (path: number[]) => {
      const preview = new Set<number>();
      for (const index of path) {
        const indices = computeBrushIndices(index);
        for (const target of indices) {
          preview.add(target);
        }
      }
      return preview;
    },
    [computeBrushIndices],
  );

  const computeLineIndices = useCallback(
    (startIndex: number, endIndex: number) =>
      computeLineIndicesOnGrid({ width: gridWidth, height: gridHeight }, startIndex, endIndex),
    [gridHeight, gridWidth],
  );

  const updateShiftLinePreview = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, targetIndex: number | null) => {
      const supportsShiftLine = tool === "pencil" || tool === "eraser";
      const clearPreview = () =>
        setPathPreview((prev) => (prev === null ? prev : null));

      if (!supportsShiftLine) {
        clearPreview();
        return;
      }

      if (isDrawingRef.current || !previewToolEffects) {
        if (!isDrawingRef.current) {
          clearPreview();
        }
        return;
      }

      if (!event.shiftKey || lastPointedIndex === null || targetIndex === null) {
        clearPreview();
        return;
      }

      const isErase =
        tool === "eraser" ||
        event.metaKey ||
        event.ctrlKey ||
        (typeof event.buttons === "number" && (event.buttons & 2) === 2);

      setDrawValue(isErase ? null : activeColor);
      const path = computeLineIndices(lastPointedIndex, targetIndex);
      setPathPreview(buildLinePreview(path));
    },
    [
      activeColor,
      buildLinePreview,
      computeLineIndices,
      lastPointedIndex,
      previewToolEffects,
      setDrawValue,
      tool,
    ],
  );

  const pickColorAtIndex = useCallback(
    (pointerIndex: number) => {
      const currentPixels = compositePixelsRef.current;
      const value = currentPixels[pointerIndex];
      const pickedColor: PaletteColor =
        value === null ? "transparent" : (value as PaletteColor);
      setActiveColor(pickedColor);
      setDrawValue(pickedColor);
    },
    [compositePixelsRef, setActiveColor, setDrawValue],
  );

  const startStroke = useCallback(
    (resolved: ResolvedPointer, nextValue: PixelValue) => {
      isDrawingRef.current = true;
      setDrawValue(nextValue);
      lastPaintedIndexRef.current = resolved.index;
      applyBrush(resolved.index, nextValue);
    },
    [applyBrush, setDrawValue],
  );

  const computeShapeCells = useCallback(
    (startIndex: number, endIndex: number, shape: ShapeKind, filled: boolean) =>
      computeShapeCellsOnGrid({ width: gridWidth, height: gridHeight }, startIndex, endIndex, shape, filled),
    [gridHeight, gridWidth],
  );

  const handleCreateLayer = useCallback(() => {
    commitSnapshot();
    const newLayer: Layer = {
      id: createLayerId(),
      name: generateLayerName(layersRef.current),
      pixels: new Array(totalCells).fill(null) as PixelValue[],
      visible: true,
    };
    const nextLayers = [...layersRef.current, newLayer];
    setLayers(nextLayers);
    setActiveLayerId(newLayer.id);
    setPathPreview(null);
    setHoverIndexIfChanged(null);
  }, [commitSnapshot, layersRef, setHoverIndexIfChanged, setLayers, setPathPreview, totalCells]);

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const currentLayers = layersRef.current;
      if (currentLayers.length <= 1) {
        return;
      }
      if (!currentLayers.some((layer) => layer.id === layerId)) {
        return;
      }
      commitSnapshot();
      const nextLayers = currentLayers.filter((layer) => layer.id !== layerId);
      if (!nextLayers.length) return;
      let nextActiveId = activeLayerId;
      if (
        layerId === activeLayerId ||
        !nextLayers.some((layer) => layer.id === activeLayerId)
      ) {
        nextActiveId = nextLayers[nextLayers.length - 1].id;
      }
      setLayers(nextLayers);
      setActiveLayerId(nextActiveId);
      setPathPreview(null);
      setHoverIndexIfChanged(null);
    },
    [activeLayerId, commitSnapshot, layersRef, setHoverIndexIfChanged, setLayers, setPathPreview],
  );

  const handleRenameLayer = useCallback(
    (layerId: string, name: string) => {
      const trimmedName = name.trim();
      const currentLayers = layersRef.current;
      const layer = currentLayers.find((item) => item.id === layerId);
      if (!layer || !trimmedName || layer.name === trimmedName) return;

      recordSnapshot();
      const nextLayers = currentLayers.map((item) =>
        item.id === layerId ? { ...item, name: trimmedName } : item,
      );
      setLayers(nextLayers);
    },
    [layersRef, recordSnapshot, setLayers],
  );

  const handleToggleLayerVisibility = useCallback(
    (layerId: string) => {
      if (!layersRef.current.some((layer) => layer.id === layerId)) {
        return;
      }
      commitSnapshot();
      const nextLayers = layersRef.current.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
      );
      setLayers(nextLayers);
    },
    [commitSnapshot, layersRef, setLayers],
  );

  const handleReorderLayers = useCallback(
    (fromIndex: number, toIndex: number) => {
      const currentLayers = layersRef.current;
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= currentLayers.length ||
        toIndex >= currentLayers.length
      ) {
        return;
      }
      commitSnapshot();
      const nextLayers = [...currentLayers];
      const [moved] = nextLayers.splice(fromIndex, 1);
      nextLayers.splice(toIndex, 0, moved);
      setLayers(nextLayers);
    },
    [commitSnapshot, layersRef, setLayers],
  );

  const handleSelectLayer = useCallback(
    (layerId: string) => {
      if (layerId === activeLayerId) return;
      if (!layersRef.current.some((layer) => layer.id === layerId)) {
        return;
      }
      setActiveLayerId(layerId);
      setPathPreview(null);
      setHoverIndexIfChanged(null);
    },
    [activeLayerId, layersRef, setHoverIndexIfChanged],
  );

  const traceWorldSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) =>
      traceWorldSegmentOnGrid({ width: gridWidth, height: gridHeight }, from, to),
    [gridHeight, gridWidth],
  );

  const buildPreviewFromAppliedCells = useCallback(
    (cells: Iterable<number>) => {
      const preview = new Set<number>();
      for (const cell of cells) {
        const footprint = computeBrushIndices(cell);
        for (const idx of footprint) {
          preview.add(idx);
        }
      }
      return preview;
    },
    [computeBrushIndices],
  );

  const appendStrokePoint = useCallback(
    (worldPoint: { x: number; y: number }) => {
      const worldPoints = strokeWorldPointsRef.current;
      const applied = strokeAppliedCellsRef.current;
      if (!worldPoints || !applied) return;
      const lastPoint = worldPoints[worldPoints.length - 1];
      if (
        lastPoint &&
        Math.hypot(lastPoint.x - worldPoint.x, lastPoint.y - worldPoint.y) < 0.01
      ) {
        return;
      }
      worldPoints.push(worldPoint);
      if (lastPoint) {
        const segmentCells = traceWorldSegment(lastPoint, worldPoint);
        if (segmentCells.length) {
          const newCells: number[] = [];
          for (const cell of segmentCells) {
            if (applied.has(cell)) continue;
            applied.add(cell);
            newCells.push(cell);
          }
          if (previewToolEffects) {
            setPathPreview(buildPreviewFromAppliedCells(applied));
          }
        }
      }
    },
    [buildPreviewFromAppliedCells, previewToolEffects, setPathPreview, traceWorldSegment],
  );

  const commitStrokeBuffer = useCallback(
    (value: PixelValue) => {
      const applied = strokeAppliedCellsRef.current;
      if (!applied || applied.size === 0) return;
      const targetCells = new Set<number>();
      for (const baseCell of applied) {
        const indices = computeBrushIndices(baseCell);
        for (const idx of indices) {
          targetCells.add(idx);
        }
      }
      if (!targetCells.size) return;
      setActiveLayerPixels((prev) => {
        const next = [...prev];
        let changed = false;
        targetCells.forEach((idx) => {
          if (next[idx] !== value) {
            next[idx] = value;
            changed = true;
          }
        });
        if (!changed) {
          return prev;
        }
        markModified();
        return next;
      });
    },
    [computeBrushIndices, markModified, setActiveLayerPixels],
  );

  const stopStroke = useCallback(() => {
    isDrawingRef.current = false;
    lastPaintedIndexRef.current = null;
    strokeWorldPointsRef.current = null;
    strokeAppliedCellsRef.current = null;
    activePointerIdRef.current = null;
    setDragStartIndex(null);
    setPathPreview(null);
    pointerQueueRef.current.length = 0;
    if (pointerRAFRef.current !== null) {
      window.cancelAnimationFrame(pointerRAFRef.current);
      pointerRAFRef.current = null;
    }
    finalizeAction();
  }, [finalizeAction]);

  const floodFill = useCallback(
    (startIndex: number, fillValue: PixelValue) => {
      let changed = false;
      setActiveLayerPixels((prev) => {
        const targetValue = prev[startIndex];
        if (targetValue === fillValue) {
          return prev;
        }

        const region = collectFillRegion(prev, startIndex, gridWidth, gridHeight);
        if (region.size === 0) {
          return prev;
        }

        const next = [...prev];
        for (const index of region) {
          next[index] = fillValue;
        }
        changed = true;
        return next;
      });

      if (changed) {
        markModified();
      }
    },
    [gridHeight, gridWidth, markModified, setActiveLayerPixels],
  );

  useEffect(() => {
    const handlePointerUp = () => {
      if (tool === "line" || tool === "shape") {
        if (dragStartIndex !== null) {
          return;
        }
      }
      stopStroke();
    };
    window.addEventListener("pointerup", handlePointerUp);
    return () => window.removeEventListener("pointerup", handlePointerUp);
  }, [dragStartIndex, stopStroke, tool]);

  type ResolvedPointer = {
    index: number;
    cellX: number;
    cellY: number;
    position: { x: number; y: number };
  };

  const resolvePointerFromClientPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      options?: { clamp?: boolean },
    ): ResolvedPointer | null => {
      const position = resolvePositionFromClientPoint(clientX, clientY, options);
      if (!position) return null;
      let cellX = Math.floor(position.x);
      let cellY = Math.floor(position.y);
      if (options?.clamp) {
        cellX = clampCellX(cellX);
        cellY = clampCellY(cellY);
      } else if (!isInBounds(cellX, cellY)) {
        return null;
      }
      return {
        index: coordsToIndex(cellX, cellY),
        cellX,
        cellY,
        position,
      };
    },
    [clampCellX, clampCellY, coordsToIndex, isInBounds, resolvePositionFromClientPoint],
  );

  const {
    cancelSelection,
    beginRectSelectGesture,
    handleSelectionBackgroundPointerDown,
    finalizeRectSelectionPointerUp,
    updateRectSelectionFromClientPoint,
  } = useSelectionGestures({
    state: selectionState,
    tool,
    gridWidth,
    gridHeight,
    gridWrapperRef,
    setPathPreview,
    resolvePointerFromClientPoint,
    beginAction,
    finalizeAction,
  });

  const { hasActiveDrag, beginMoveDrag, updateMoveDrag, finishMoveDrag } = useMoveDrag({
    gridWidth,
    gridHeight,
    totalCells,
    tool,
    autoPickLayer,
    gridRef,
    layersRef,
    setLayers,
    activeLayerId,
    setActiveLayerId,
    setActiveLayerPixelsState,
    selectionRef,
    setSelection,
    captureSelectionPixels,
    resolvePointerFromClientPoint,
    saveStacks,
    restoreStacks,
    beginActionWithSnapshot,
    finalizeAction,
  });

  const resolvePointerFromPointerEvent = useCallback(
    (event: ReactPointerEvent<Element>, options?: { clamp?: boolean }) =>
      resolvePointerFromClientPoint(event.clientX, event.clientY, options),
    [resolvePointerFromClientPoint],
  );

  const resolveIndexFromPointerEvent = useCallback(
    (event: ReactPointerEvent<Element>, options?: { clamp?: boolean }) =>
      resolvePointerFromClientPoint(event.clientX, event.clientY, options)?.index ?? null,
    [resolvePointerFromClientPoint],
  );

  const flushPointerQueue = useCallback(function flushPointerQueueInternal() {
    pointerRAFRef.current = null;
    if (!isDrawingRef.current) {
      pointerQueueRef.current.length = 0;
      return;
    }
    const pending = pointerQueueRef.current.splice(0, pointerQueueRef.current.length);
    let lastIndex: number | null = null;
    for (const point of pending) {
      const resolved = resolvePointerFromClientPoint(point.x, point.y, {
        clamp: true,
      });
      if (!resolved) continue;
      appendStrokePoint(resolved.position);
      lastIndex = resolved.index;
    }
    if (lastIndex !== null) {
      setHoverIndexIfChanged(lastIndex);
    }
    if (pointerQueueRef.current.length) {
      pointerRAFRef.current = window.requestAnimationFrame(
        flushPointerQueueInternal,
      );
    }
  }, [appendStrokePoint, resolvePointerFromClientPoint, setHoverIndexIfChanged]);

  const enqueuePointerPosition = useCallback(
    (clientX: number, clientY: number) => {
      if (typeof window === "undefined") return;
      pointerQueueRef.current.push({ x: clientX, y: clientY });
      if (pointerRAFRef.current === null) {
        pointerRAFRef.current = window.requestAnimationFrame(flushPointerQueue);
      }
    },
    [flushPointerQueue],
  );

  const processDrawingSamples = useCallback(
    (samples: PointerEvent[]) => {
      for (const sample of samples) {
        enqueuePointerPosition(sample.clientX, sample.clientY);
      }
    },
    [enqueuePointerPosition],
  );

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleGlobalPointerMove = (event: PointerEvent) => {
      if (!isDrawingRef.current) return;
      if (tool === "line" || tool === "shape") {
        return;
      }
      if (
        activePointerIdRef.current !== null &&
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }
      const coalesced =
        typeof event.getCoalescedEvents === "function"
          ? event.getCoalescedEvents()
          : [];
      const samples =
        coalesced.length > 0 ? [...coalesced, event] : [event];
      processDrawingSamples(samples);
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: false });
    return () => {
      window.removeEventListener("pointermove", handleGlobalPointerMove);
    };
  }, [processDrawingSamples, tool]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, index: number) => {
      event.preventDefault();
      const focusedElement = document.activeElement;
      if (focusedElement instanceof HTMLInputElement && focusedElement.hasAttribute("data-brush-size-input")) {
        focusedElement.blur();
        ignoredCanvasPointerIdRef.current = event.pointerId;
        return;
      }
      if (tool === "move") {
        const resolved = resolvePointerFromPointerEvent(event, { clamp: true });
        if (!resolved) return;
        beginMoveDrag(event.currentTarget, event.pointerId, resolved);
        return;
      }
      if (tool === "rect-select") {
        const resolved = resolvePointerFromPointerEvent(event, { clamp: true });
        if (!resolved) return;
        beginRectSelectGesture(event.currentTarget, event.pointerId, resolved.cellX, resolved.cellY);
        return;
      }
      const resolved = resolvePointerFromPointerEvent(event, { clamp: true });
      const pointerIndex = resolved?.index ?? index;
      const pointerData: ResolvedPointer =
        resolved ?? {
          index: pointerIndex,
          cellX: pointerIndex % gridWidth,
          cellY: Math.floor(pointerIndex / gridWidth),
          position: { x: pointerIndex % gridWidth + 0.5, y: Math.floor(pointerIndex / gridWidth) + 0.5 },
        };

      const activeSelection = selectionRef.current;
      if (
        activeSelection &&
        !selectionContainsCell(activeSelection, pointerData.cellX, pointerData.cellY)
      ) {
        cancelSelection();
      }

      setHoverIndexIfChanged(pointerIndex);
      pointerQueueRef.current.length = 0;
      if (pointerRAFRef.current !== null) {
        window.cancelAnimationFrame(pointerRAFRef.current);
        pointerRAFRef.current = null;
      }

      if (tool === "magnifier") {
        const direction = event.shiftKey ? "out" : zoomMode;
        zoomAtClientPoint(direction, 1, event.clientX, event.clientY);
        return;
      }

      if (tool === "picker" || event.altKey) {
        pickColorAtIndex(pointerIndex);
        return;
      }

      const isRightClick = event.button === 2;
      const isErase = isRightClick || event.metaKey || event.ctrlKey;
      beginAction();
      if (tool === "bucket") {
        floodFill(pointerIndex, isErase ? null : activeColor);
        return;
      }
      const strokeColor =
        tool === "eraser" ? null : isErase ? null : activeColor;

      if (tool === "line" || tool === "shape") {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
          activePointerIdRef.current = event.pointerId;
        } catch {
          activePointerIdRef.current = event.pointerId;
        }
        isDrawingRef.current = true;
        setDrawValue(strokeColor);
        lastPaintedIndexRef.current = null;
        setDragStartIndex(pointerIndex);
        if (previewToolEffects) {
          const initialPath =
            tool === "line"
              ? computeLineIndices(pointerIndex, pointerIndex)
              : computeShapeCells(pointerIndex, pointerIndex, shapeType, shapeFilled);
          setPathPreview(buildLinePreview(initialPath));
        } else {
          setPathPreview(null);
        }
        return;
      }

      if (event.shiftKey && lastPointedIndex !== null) {
        const line = computeLineIndices(lastPointedIndex, pointerIndex);
        for (let position = 1; position < line.length; position += 1) {
          applyBrush(line[position], strokeColor);
        }
        setDrawValue(strokeColor);
        lastPaintedIndexRef.current = pointerIndex;
        setPathPreview(null);
        return;
      }

      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        activePointerIdRef.current = event.pointerId;
      } catch {
        activePointerIdRef.current = event.pointerId;
      }

      if (tool === "pencil" || tool === "eraser") {
        strokeWorldPointsRef.current = [pointerData.position];
        const applied = new Set<number>();
        applied.add(pointerData.index);
        strokeAppliedCellsRef.current = applied;
        if (previewToolEffects) {
          setPathPreview(buildPreviewFromAppliedCells(applied));
        } else {
          setPathPreview(null);
        }
      } else {
        strokeWorldPointsRef.current = null;
        strokeAppliedCellsRef.current = null;
      }

      startStroke(pointerData, strokeColor);
      if (strokeAppliedCellsRef.current && (tool === "pencil" || tool === "eraser")) {
        strokeAppliedCellsRef.current.add(pointerData.index);
        if (previewToolEffects) {
          setPathPreview(
            buildPreviewFromAppliedCells(strokeAppliedCellsRef.current),
          );
        }
      }
    },
    [
      activeColor,
      applyBrush,
      beginAction,
      beginMoveDrag,
      beginRectSelectGesture,
      buildLinePreview,
      buildPreviewFromAppliedCells,
      cancelSelection,
      computeLineIndices,
      computeShapeCells,
      floodFill,
      gridWidth,
      lastPointedIndex,
      pickColorAtIndex,
      previewToolEffects,
      resolvePointerFromPointerEvent,
      selectionContainsCell,
      selectionRef,
      setDrawValue,
      setHoverIndexIfChanged,
      shapeFilled,
      shapeType,
      startStroke,
      tool,
      zoomAtClientPoint,
      zoomMode,
  ],
  );

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, index: number) => {
      if (ignoredCanvasPointerIdRef.current === event.pointerId) return;
      const resolved = resolvePointerFromPointerEvent(event, {
        clamp: isDrawingRef.current,
      });
      const pointerIndex = resolved?.index ?? index;
      setHoverIndexIfChanged(pointerIndex);
      if (!isDrawingRef.current) {
        updateShiftLinePreview(event, pointerIndex);
        return;
      }
      event.preventDefault();
      if (tool === "line" || tool === "shape") {
        if (dragStartIndex === null) return;
        if (previewToolEffects) {
          const path =
            tool === "line"
              ? computeLineIndices(dragStartIndex, pointerIndex)
              : computeShapeCells(dragStartIndex, pointerIndex, shapeType, shapeFilled);
          setPathPreview(buildLinePreview(path));
        }
        return;
      }
      if (!resolved) return;
      appendStrokePoint(resolved.position);
    },
    [
      buildLinePreview,
      computeLineIndices,
      computeShapeCells,
      appendStrokePoint,
      dragStartIndex,
      previewToolEffects,
      setHoverIndexIfChanged,
      shapeFilled,
      shapeType,
      tool,
      updateShiftLinePreview,
      resolvePointerFromPointerEvent,
    ],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const nativeEvent = event.nativeEvent;
      if (ignoredCanvasPointerIdRef.current === nativeEvent.pointerId) return;
      const coalesced =
        typeof nativeEvent.getCoalescedEvents === "function"
          ? nativeEvent.getCoalescedEvents()
          : [];
      const samples =
        coalesced.length > 0 ? [...coalesced, nativeEvent] : [nativeEvent];

      if (tool === "move" && hasActiveDrag()) {
        const lastSample = samples[samples.length - 1];
        updateMoveDrag(lastSample.clientX, lastSample.clientY, nativeEvent.pointerId);
        return;
      }

      if (tool === "rect-select") {
        const lastSample = samples[samples.length - 1];
        if (updateRectSelectionFromClientPoint(lastSample.clientX, lastSample.clientY)) {
          return;
        }
      }

      if (!isDrawingRef.current) {
        const lastSample = samples[samples.length - 1];
        const resolved = resolvePointerFromClientPoint(
          lastSample.clientX,
          lastSample.clientY,
        );
        const pointerIndex = resolved?.index ?? null;
        setHoverIndexIfChanged(pointerIndex);
        updateShiftLinePreview(event, pointerIndex);
        return;
      }
      if (
        activePointerIdRef.current !== null &&
        nativeEvent.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      if (tool === "line" || tool === "shape") {
        if (dragStartIndex === null) return;
        let lastResolved: ResolvedPointer | null = null;
        for (const sample of samples) {
          const sampleResolved = resolvePointerFromClientPoint(
            sample.clientX,
            sample.clientY,
            { clamp: true },
          );
          if (!sampleResolved) continue;
          lastResolved = sampleResolved;
        }
        if (lastResolved === null) return;
        event.preventDefault();
        setHoverIndexIfChanged(lastResolved.index);
        if (previewToolEffects) {
          const path =
            tool === "line"
              ? computeLineIndices(dragStartIndex, lastResolved.index)
              : computeShapeCells(
                dragStartIndex,
                lastResolved.index,
                shapeType,
                shapeFilled,
              );
          setPathPreview(buildLinePreview(path));
        }
        return;
      }

      event.preventDefault();
      processDrawingSamples(samples);
    },
    [
      buildLinePreview,
      computeLineIndices,
      computeShapeCells,
      dragStartIndex,
      previewToolEffects,
      processDrawingSamples,
      resolvePointerFromClientPoint,
      setHoverIndexIfChanged,
      shapeFilled,
      shapeType,
      tool,
      updateShiftLinePreview,
      hasActiveDrag,
      updateRectSelectionFromClientPoint,
      updateMoveDrag,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (ignoredCanvasPointerIdRef.current === event.pointerId) {
        ignoredCanvasPointerIdRef.current = null;
        return;
      }
      if (tool === "move" && hasActiveDrag()) {
        updateMoveDrag(event.clientX, event.clientY, event.pointerId);
        finishMoveDrag(event.pointerId, false);
        return;
      }
      const handledSelectionPointerUp = finalizeRectSelectionPointerUp({
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
      });
      if (handledSelectionPointerUp) {
        return;
      }
      const wasDragAction = tool === "line" || tool === "shape";
      const capturedPointer = activePointerIdRef.current;
      const releasePointer = typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId);
      const finalize = () => {
        stopStroke();
        setHoverIndexIfChanged(null);
      };
      flushPointerQueue();
      if (tool === "pencil" || tool === "eraser") {
        const resolvedPointer = resolvePointerFromPointerEvent(event, { clamp: true });
        if (resolvedPointer) {
          appendStrokePoint(resolvedPointer.position);
        }
        commitStrokeBuffer(drawValueRef.current);
      }
      const pointerUpIndex = resolveIndexFromPointerEvent(event, { clamp: true });
      setLastPointedIndex(pointerUpIndex ?? hoverIndex ?? lastPointedIndex);

      if (wasDragAction) {
        const eventIndex = resolveIndexFromPointerEvent(event, { clamp: true });
        const endIndex = eventIndex ?? hoverIndex ?? dragStartIndex;
        if (dragStartIndex !== null && endIndex !== null) {
          const path =
            tool === "line"
              ? computeLineIndices(dragStartIndex, endIndex)
              : computeShapeCells(dragStartIndex, endIndex, shapeType, shapeFilled);
          const before = activeLayerPixelsRef.current.slice();
          applyLinePath(path, drawValueRef.current);
          const after = activeLayerPixelsRef.current;
          if (!arePixelsEqual(before, after)) {
            markModified();
          }
        }
        setDragStartIndex(null);
        setPathPreview(null);
        if (releasePointer && event.pointerId === capturedPointer) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finalize();
        return;
      }

      if (releasePointer && event.pointerId === capturedPointer) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      finalize();
    },
    [
      activeLayerPixelsRef,
      appendStrokePoint,
      applyLinePath,
      commitStrokeBuffer,
      computeLineIndices,
      computeShapeCells,
      dragStartIndex,
      finalizeRectSelectionPointerUp,
      finishMoveDrag,
      flushPointerQueue,
      hasActiveDrag,
      hoverIndex,
      lastPointedIndex,
      markModified,
      resolveIndexFromPointerEvent,
      resolvePointerFromPointerEvent,
      setHoverIndexIfChanged,
      shapeFilled,
      shapeType,
      stopStroke,
      tool,
      updateMoveDrag,
    ],
  );

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (ignoredCanvasPointerIdRef.current === event.pointerId) {
      ignoredCanvasPointerIdRef.current = null;
      return;
    }
    finishMoveDrag(event.pointerId, true);
  }, [finishMoveDrag]);

  useEffect(() => {
    const clearIgnoredPointer = (event: PointerEvent) => {
      if (ignoredCanvasPointerIdRef.current === event.pointerId) {
        ignoredCanvasPointerIdRef.current = null;
      }
    };
    window.addEventListener("pointerup", clearIgnoredPointer);
    window.addEventListener("pointercancel", clearIgnoredPointer);
    return () => {
      window.removeEventListener("pointerup", clearIgnoredPointer);
      window.removeEventListener("pointercancel", clearIgnoredPointer);
    };
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (!isDrawingRef.current) {
      setHoverIndexIfChanged(null);
      if (tool === "line" || tool === "shape" || tool === "pencil" || tool === "eraser" || tool === "rect-select") {
        setPathPreview(null);
      }
    }
  }, [setHoverIndexIfChanged, tool]);

  const bucketPreview = useMemo(() => {
    if (!previewToolEffects || hoverIndex === null || tool !== "bucket") return null;
    const targetColor = activeLayerPixels[hoverIndex];
    if (targetColor === undefined) return null;

    return collectFillRegion(activeLayerPixels, hoverIndex, gridWidth, gridHeight);
  }, [activeLayerPixels, gridHeight, gridWidth, hoverIndex, previewToolEffects, tool]);

  const brushPreview = useMemo(() => {
    if (
      brushSizeDragging ||
      !previewToolEffects ||
      hoverIndex === null ||
      (tool !== "pencil" && tool !== "eraser" && tool !== "line" && tool !== "shape")
    ) {
      return null;
    }
    return new Set(computeBrushIndices(hoverIndex));
  }, [brushSizeDragging, computeBrushIndices, hoverIndex, previewToolEffects, tool]);

  const brushSizePreview = useMemo(() => {
    if (!brushSizeDragging || canvasViewport.width <= 0 || canvasViewport.height <= 0) return null;
    const artworkLeft = renderOffsetX - scrollOriginX;
    const artworkTop = renderOffsetY - scrollOriginY;
    const visibleLeft = Math.max(0, artworkLeft);
    const visibleRight = Math.min(canvasViewport.width, artworkLeft + contentWidth);
    const visibleTop = Math.max(0, artworkTop);
    const visibleBottom = Math.min(canvasViewport.height, artworkTop + contentHeight);
    if (visibleRight <= visibleLeft || visibleBottom <= visibleTop) return null;

    const centerX = Math.min(gridWidth - 1, Math.max(0,
      Math.floor(((visibleLeft + visibleRight) / 2 - artworkLeft) / displayCellSize),
    ));
    const centerY = Math.min(gridHeight - 1, Math.max(0,
      Math.floor(((visibleTop + visibleBottom) / 2 - artworkTop) / displayCellSize),
    ));
    return new Set(computeBrushIndices(centerY * gridWidth + centerX));
  }, [brushSizeDragging, canvasViewport.height, canvasViewport.width, computeBrushIndices, contentHeight, contentWidth, displayCellSize, gridHeight, gridWidth, renderOffsetX, renderOffsetY, scrollOriginX, scrollOriginY]);

  const reset = useCallback(() => {
    const isAlreadyEmpty = compositePixelsRef.current.every(
      (value) => value === null,
    );
    if (isAlreadyEmpty) return;
    commitSnapshot();
    setLayers((prevLayers) => {
      const clearedLayers = prevLayers.map((layer) => ({
        ...layer,
        pixels: new Array(totalCells).fill(null) as PixelValue[],
      }));
      const activeLayer = clearedLayers.find(
        (layer) => layer.id === activeLayerId,
      );
      if (activeLayer) {
        const cloned = activeLayer.pixels.slice();
        setActiveLayerPixelsState(cloned);
      }
      return clearedLayers;
    });
    setHoverIndexIfChanged(null);
  }, [activeLayerId, commitSnapshot, compositePixelsRef, setActiveLayerPixelsState, setHoverIndexIfChanged, setLayers, totalCells]);



  const handleCloseResetDialog = useCallback(() => {
    setIsResetDialogOpen(false);
  }, []);

  const handleConfirmReset = useCallback(() => {
    setIsResetDialogOpen(false);
    reset();
  }, [reset]);

  useEscapeKey(isResetDialogOpen, handleCloseResetDialog);

  const handleOpenSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(true);
  }, []);

  const handleCloseSettingsDialog = useCallback(() => {
    setIsSettingsDialogOpen(false);
  }, []);

  const handleOpenChangelogDialog = useCallback(() => {
    setIsChangelogDialogOpen(true);
  }, []);

  const handleCloseChangelogDialog = useCallback(() => {
    setIsChangelogDialogOpen(false);
  }, []);

  useEscapeKey(isSettingsDialogOpen, handleCloseSettingsDialog);
  useEscapeKey(isChangelogDialogOpen, handleCloseChangelogDialog);

  const handleCloseHotkeysDialog = useCallback(() => {
    setIsHotkeysDialogOpen(false);
  }, []);

  useEscapeKey(isHotkeysDialogOpen, handleCloseHotkeysDialog);
  useEscapeKey(isSaveDialogOpen, handleCloseSaveDialog);

  const selectedColorStyles = useMemo<SelectedColorStyles>(
    () =>
      activeColor === "transparent"
        ? { backgroundColor: "transparent", ...checkerboardStyle(12) }
        : { backgroundColor: activeColor },
    [activeColor],
  );

  const closeMobilePanel = useCallback(() => {
    const button = mobilePanel === "layers" ? mobileLayersButtonRef.current : mobilePaletteButtonRef.current;
    setMobilePanel(null);
    button?.focus();
  }, [mobilePanel]);

  useEscapeKey(mobilePanel !== null, closeMobilePanel, { ignoreDefaultPrevented: true });

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-50">
        <section className="shrink-0 overflow-x-auto border-b border-zinc-900 px-3 py-3 md:px-8" aria-label="General actions">
          <div className="flex w-max min-w-full flex-nowrap items-center justify-start gap-3 [&>button]:shrink-0">
            <button
              type="button"
              onClick={undo}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canUndo}
              aria-label="Undo"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={redo}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canRedo}
              aria-label="Redo"
            >
              Redo
            </button>
            <button
              type="button"
              onClick={handleOpenResetDialog}
              className="rounded-full bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 dark:bg-zinc-50"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={handleOpenSettingsDialog}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Settings
            </button>
            <button
              type="button"
              onClick={() => setIsHotkeysDialogOpen(true)}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Hotkeys
            </button>
            <button
              type="button"
              onClick={handleOpenSaveDialog}
              className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
            >
              Save PNG
            </button>
          </div>
        </section>
        <div className="flex flex-1 min-h-0 lg:max-h-full">
          <aside className="hidden md:flex md:w-64 lg:w-72 flex-col border-r border-zinc-900 bg-zinc-950">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <LayersPanel
                layers={layers}
                activeLayerId={activeLayerId}
                onSelectLayer={handleSelectLayer}
                onCreateLayer={handleCreateLayer}
                onDeleteLayer={handleDeleteLayer}
                onRenameLayer={handleRenameLayer}
                onToggleVisibility={handleToggleLayerVisibility}
                onReorderLayers={handleReorderLayers}
                layerPreviews={layerPreviews}
              />
            </div>
            <div className="shrink-0 border-t border-zinc-900 p-4">
              <PalettePanel
                paletteThemeId={paletteThemeId}
                setPaletteThemeId={setPaletteThemeId}
                currentPalette={currentPalette}
                drawValueRef={drawValueRef}
                setActiveColor={setActiveColor}
                paletteColors={paletteColors}
                activeColor={activeColor}
                selectedColorStyles={selectedColorStyles}
              />
            </div>
            <div className="border-t border-zinc-900 p-4">
              <div className="flex h-12 items-end justify-center">
                <button
                  type="button"
                  onClick={handleOpenChangelogDialog}
                  className="flex select-none items-center gap-2 rounded-md px-2 py-1 transition hover:bg-zinc-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
                  aria-label="Open changelog"
                >
                  <Image
                    src="/logos/PixiePaintLogo.png"
                    alt="Pixie Paint Logo"
                    width={110}
                    height={32}
                    priority
                    style={{ imageRendering: "pixelated" }}
                  />
                  <span className="text-xs font-medium text-zinc-300">
                    v{APP_VERSION}
                  </span>
                </button>
              </div>
            </div>
          </aside>
          <main className="flex flex-1 min-w-0 flex-col">
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div className="flex h-full w-full flex-col items-center justify-center">
                <PixelGrid
                  gridWidth={gridWidth}
                  gridHeight={gridHeight}
                  displayCellSize={displayCellSize}
                  gridWrapperRef={gridWrapperRef}
                  gridRef={gridRef}
                  pixels={compositePixels}
                  showPixelGrid={showPixelGrid}
                  checkerSize={checkerSize}
                  previewToolEffects={previewToolEffects}
                  dimStrokePreview={dimStrokePreview}
                  bucketPreview={bucketPreview}
                  brushPreview={brushPreview}
                  brushSizePreview={brushSizePreview}
                  pathPreview={pathPreview}
                  activeColor={activeColor}
                  drawValueRef={drawValueRef}
                  drawValueVersion={drawValueVersion}
                  tool={tool}
                  toolCursorIcon={currentTool.cursorIcon}
                  toolCursorHotspot={currentTool.cursorHotspot}
                  useToolAsMousePointer={useToolAsMousePointer}
                  wrapperMaxWidth={availableWidth}
                  wrapperMaxHeight={availableHeight}
                  canvasScroll={canvasScroll}
                  onScrollChange={setCanvasScrollLimited}
                  onViewportResize={handleViewportResize}
                  onWheelZoom={handleWheelZoom}
                  selectionOverlay={selection}
                  selectionPreviewRect={selectionPreviewRect}
                  handlePointerDown={handlePointerDown}
                  handlePointerEnter={handlePointerEnter}
                  handlePointerMove={handlePointerMove}
                  handlePointerUp={handlePointerUp}
                  handlePointerCancel={handlePointerCancel}
                  handlePointerLeave={handlePointerLeave}
                  onBackgroundPointerDown={handleSelectionBackgroundPointerDown}
                />
              </div>
              {mobilePanel ? (
                <section
                  id={`mobile-${mobilePanel}-panel`}
                  data-tool-settings
                  aria-labelledby={`mobile-${mobilePanel}-title`}
                  className="absolute inset-x-0 bottom-0 z-30 flex max-h-[60%] flex-col rounded-t-xl border border-b-0 border-zinc-700 bg-zinc-900 shadow-2xl md:hidden"
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-zinc-700 px-4 py-2">
                    <h2 id={`mobile-${mobilePanel}-title`} className="text-sm font-semibold uppercase tracking-wide text-zinc-100">
                      {mobilePanel === "layers" ? "Layers" : "Palette"}
                    </h2>
                    <button
                      type="button"
                      onClick={closeMobilePanel}
                      className="rounded-md px-3 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200"
                      aria-label={`Close ${mobilePanel}`}
                    >
                      Close
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                    {mobilePanel === "layers" ? (
                      <LayersPanel
                        layers={layers}
                        activeLayerId={activeLayerId}
                        onSelectLayer={handleSelectLayer}
                        onCreateLayer={handleCreateLayer}
                        onDeleteLayer={handleDeleteLayer}
                        onRenameLayer={handleRenameLayer}
                        onToggleVisibility={handleToggleLayerVisibility}
                        onReorderLayers={handleReorderLayers}
                        layerPreviews={layerPreviews}
                      />
                    ) : (
                      <PalettePanel
                        paletteThemeId={paletteThemeId}
                        setPaletteThemeId={setPaletteThemeId}
                        currentPalette={currentPalette}
                        drawValueRef={drawValueRef}
                        setActiveColor={setActiveColor}
                        paletteColors={paletteColors}
                        activeColor={activeColor}
                        selectedColorStyles={selectedColorStyles}
                      />
                    )}
                  </div>
                </section>
              ) : null}
            </div>
            <nav data-tool-settings className="flex h-12 shrink-0 items-center gap-2 border-t border-zinc-900 px-4 md:hidden" aria-label="Canvas panels">
              <button
                ref={mobileLayersButtonRef}
                type="button"
                onClick={() => setMobilePanel((current) => current === "layers" ? null : "layers")}
                aria-expanded={mobilePanel === "layers"}
                aria-controls={mobilePanel === "layers" ? "mobile-layers-panel" : undefined}
                className={`h-9 flex-1 rounded-md border px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 ${mobilePanel === "layers" ? "border-zinc-500 bg-zinc-700 text-white" : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"}`}
              >
                Layers
              </button>
              <button
                ref={mobilePaletteButtonRef}
                type="button"
                onClick={() => setMobilePanel((current) => current === "palette" ? null : "palette")}
                aria-expanded={mobilePanel === "palette"}
                aria-controls={mobilePanel === "palette" ? "mobile-palette-panel" : undefined}
                className={`h-9 flex-1 rounded-md border px-3 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-200 ${mobilePanel === "palette" ? "border-zinc-500 bg-zinc-700 text-white" : "border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"}`}
              >
                Palette
              </button>
            </nav>
            <section className="shrink-0 overflow-x-auto border-t border-zinc-900 px-4 py-2 md:px-6" aria-label="Tools">
              <div className="mx-auto max-w-4xl">
                <Toolbox tools={TOOLS} selectedToolId={tool} onSelect={setTool} />
              </div>
            </section>
            <section className="border-t border-zinc-900 px-4 md:px-6" aria-label="Tool settings">
              <ToolSettingsPanel
                currentTool={currentTool}
                brushSize={brushSize}
                onBrushSizeChange={setBrushSize}
                onBrushSizeDragChange={setBrushSizeDragging}
                brushShape={brushShape}
                onBrushShapeChange={setBrushShape}
                shapeType={shapeType}
                onShapeTypeChange={setShapeType}
                shapeFilled={shapeFilled}
                onShapeFilledChange={setShapeFilled}
                zoomMode={zoomMode}
                onZoomModeChange={setZoomMode}
                autoPickLayer={autoPickLayer}
                onAutoPickLayerChange={setAutoPickLayer}
              />
            </section>
          </main>
        </div>
      </div>
      <PixelPencilModals
        isSaveDialogOpen={isSaveDialogOpen}
        handleCloseSaveDialog={handleCloseSaveDialog}
        handleConfirmSave={handleConfirmSave}
        exportScale={exportScale}
        setExportScale={setExportScaleState}
        exportFilename={exportFilename}
        setExportFilename={setExportFilenameState}
        previewDataUrl={previewDataUrl}
        gridWidth={gridWidth}
        gridHeight={gridHeight}
        isSettingsDialogOpen={isSettingsDialogOpen}
        handleCloseSettingsDialog={handleCloseSettingsDialog}
        isChangelogDialogOpen={isChangelogDialogOpen}
        handleCloseChangelogDialog={handleCloseChangelogDialog}
        isHotkeysDialogOpen={isHotkeysDialogOpen}
        handleCloseHotkeysDialog={handleCloseHotkeysDialog}
        hotkeys={HOTKEY_ITEMS}
        isResetDialogOpen={isResetDialogOpen}
        handleCloseResetDialog={handleCloseResetDialog}
        handleConfirmReset={handleConfirmReset}
      />
    </>
  );
}
