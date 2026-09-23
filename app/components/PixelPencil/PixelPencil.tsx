"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { PaintTool, PaletteTheme, BrushShape, PaletteColor, PixelValue, ShapeKind } from "./PixelPencilTypes";
import { BucketTool, ColorPickerTool, EraserTool, LineTool, MagnifierTool, MoveTool, PencilTool, RectSelectionTool, ShapeTool } from "./PixelPencilTools";
import { PixelPencilPalettes } from "./PixelPencilPalettes";
import { CANVAS_PIXEL_SIZE_OPTIONS, usePixelPencilSettings } from "./context/PixelPencilSettingsContext";
import { MAX_HISTORY, MAX_ZOOM_SCALE } from "./PixelPencil.constants";
import { usePixelExport } from "./hooks/usePixelExport";
import { useZoomControls } from "./hooks/useZoomControls";
import { Toolbox } from "./Toolbox";
import { ToolSettingsPanel } from "./ToolSettingsPanel";
import { PalettePanel } from "./PalettePanel";
import { PixelGrid } from "./PixelGrid";
import { PixelPencilModals } from "./PixelPencilModals";
import { LayersPanel } from "./LayersPanel";
import { composeLayers, translatePixels } from "./pixel-operations";
import { getPanBounds, includePanOffset } from "./canvas-pan";
import packageJson from "../../../package.json";

const TOOLS: readonly PaintTool[] = [
  PencilTool,
  EraserTool,
  BucketTool,
  ColorPickerTool,
  LineTool,
  ShapeTool,
  RectSelectionTool,
  MoveTool,
  MagnifierTool,
] as const;

const PALETTE_THEMES: readonly PaletteTheme[] = PixelPencilPalettes;
type Tool = (typeof TOOLS)[number]["id"];

const RESAMPLE_STEP = 0.5; // cells
const MAX_SEGMENT_STEPS = 2048;
const APP_VERSION = packageJson.version;


const arePixelsEqual = (a: PixelValue[], b: PixelValue[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
};

type Layer = {
  id: string;
  name: string;
  pixels: PixelValue[];
  visible: boolean;
};

type LayerSnapshot = {
  layers: Layer[];
  activeLayerId: string;
  selection: SelectionState | null;
};

const createLayerId = () =>
  `layer-${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36)}`;

type SelectionRect = { x: number; y: number; width: number; height: number };
type SelectionPixel = { relX: number; relY: number; color: PixelValue };
type SelectionState = {
  rect: SelectionRect;
  offset: { dx: number; dy: number };
  pixels: SelectionPixel[];
  isFloating: boolean;
};

type MoveDrag = {
  pointerId: number;
  layerId: string;
  originalActiveLayerId: string;
  origin: { x: number; y: number };
  delta: { dx: number; dy: number };
  sourcePixels: PixelValue[];
  movePixels: PixelValue[];
  sourceSelection: SelectionState | null;
  previousUndo: LayerSnapshot[];
  previousRedo: LayerSnapshot[];
  actionStarted: boolean;
};

const cloneLayer = (layer: Layer, totalCells: number): Layer => {
  const pixels = new Array(totalCells).fill(null) as PixelValue[];
  const limit = Math.min(totalCells, layer.pixels.length);
  for (let index = 0; index < limit; index += 1) {
    pixels[index] = layer.pixels[index] ?? null;
  }
  return {
    ...layer,
    pixels,
  };
};

const cloneLayers = (layers: Layer[], totalCells: number) =>
  layers.map((layer) => cloneLayer(layer, totalCells));

const cloneSelection = (selection: SelectionState | null): SelectionState | null => {
  if (!selection) return null;
  return {
    rect: { ...selection.rect },
    offset: { ...selection.offset },
    pixels: selection.pixels.map((pixel) => ({ ...pixel })),
    isFloating: selection.isFloating,
  };
};

const areSelectionPixelsEqual = (a: SelectionPixel[], b: SelectionPixel[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const pixelA = a[index];
    const pixelB = b[index];
    if (
      pixelA.relX !== pixelB.relX ||
      pixelA.relY !== pixelB.relY ||
      pixelA.color !== pixelB.color
    ) {
      return false;
    }
  }
  return true;
};

const areSelectionsEqual = (a: SelectionState | null, b: SelectionState | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height &&
    a.offset.dx === b.offset.dx &&
    a.offset.dy === b.offset.dy &&
    a.isFloating === b.isFloating &&
    areSelectionPixelsEqual(a.pixels, b.pixels)
  );
};

const areLayersEqual = (a: Layer[], b: Layer[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const layerA = a[index];
    const layerB = b[index];
    if (
      layerA.id !== layerB.id ||
      layerA.name !== layerB.name ||
      layerA.visible !== layerB.visible ||
      !arePixelsEqual(layerA.pixels, layerB.pixels)
    ) {
      return false;
    }
  }
  return true;
};

const generateLayerName = (existingLayers: Layer[]) => {
  let suffix = existingLayers.length + 1;
  while (existingLayers.some((layer) => layer.name === `Layer ${suffix}`)) {
    suffix += 1;
  }
  return `Layer ${suffix}`;
};

export function PixelPencil() {
  const {
    previewToolEffects,
    dimStrokePreview,
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
  const [layers, setLayers] = useState<Layer[]>(() => [
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
  const [activeLayerPixels, setActiveLayerPixelsState] = useState<PixelValue[]>(
    initialLayerPixelsRef.current as PixelValue[],
  );
  const [compositePixels, setCompositePixels] = useState<PixelValue[]>(
    () => createEmptyPixelArray(),
  );
  const [layerPreviews, setLayerPreviews] = useState<Record<string, string>>({});
  const [paletteThemeId, setPaletteThemeId] = useState<
    (typeof PALETTE_THEMES)[number]["id"]
  >(PALETTE_THEMES[0].id);
  const [activeColor, setActiveColor] = useState<PaletteColor>(
    PALETTE_THEMES[0].colors[0],
  );
  const [tool, setTool] = useState<Tool>("pencil");
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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isSettingsDialogOpen, setIsSettingsDialogOpen] = useState(false);
  const [isChangelogDialogOpen, setIsChangelogDialogOpen] = useState(false);
  const [isHotkeysDialogOpen, setIsHotkeysDialogOpen] = useState(false);
  const { zoomScale, setZoomScale, zoomMode, setZoomMode } = useZoomControls();
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
  const activeLayerPixelsRef = useRef(activeLayerPixels);
  const compositePixelsRef = useRef(compositePixels);
  const layersRef = useRef(layers);
  const undoStackRef = useRef<LayerSnapshot[]>([]);
  const redoStackRef = useRef<LayerSnapshot[]>([]);
  const actionInProgressRef = useRef(false);
  const actionModifiedRef = useRef(false);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const wrapperParentWidthRef = useRef<number | null>(null);
  const wrapperParentHeightRef = useRef<number | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const ignoredCanvasPointerIdRef = useRef<number | null>(null);
  const pointerQueueRef = useRef<{ x: number; y: number }[]>([]);
  const pointerRAFRef = useRef<number | null>(null);
  const selectionDraftOriginRef = useRef<{ x: number; y: number } | null>(null);
  const selectionMoveRef = useRef<
    | {
      pointer: { x: number; y: number };
      startOffset: { dx: number; dy: number };
    }
    | null
  >(null);
  const selectionLastPointerCellRef = useRef<{ x: number; y: number } | null>(null);
  const selectionActionActiveRef = useRef(false);
  const selectionPointerIdRef = useRef<number | null>(null);
  const moveDragRef = useRef<MoveDrag | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const [pathPreview, setPathPreview] = useState<Set<number> | null>(null);
  const [availableWidth, setAvailableWidth] = useState<number>(0);
  const [availableHeight, setAvailableHeight] = useState<number>(0);
  const [canvasScroll, setCanvasScroll] = useState({ x: 0, y: 0 });
  const [zoomPanException, setZoomPanException] = useState(false);
  const [canvasViewport, setCanvasViewport] = useState({ width: 0, height: 0 });
  const selectionRef = useRef<SelectionState | null>(null);
  const [selection, setSelectionState] = useState<SelectionState | null>(null);
  const setSelection = useCallback(
    (
      value:
        | SelectionState
        | null
        | ((previous: SelectionState | null) => SelectionState | null),
    ) => {
      setSelectionState((previous) => {
        const next =
          typeof value === "function"
            ? (value as (prev: SelectionState | null) => SelectionState | null)(
              previous,
            )
            : value;
        selectionRef.current = next;
        return next;
      });
    },
    [],
  );
  const [selectionPreviewRect, setSelectionPreviewRect] = useState<SelectionRect | null>(null);
  const prevDimensionsRef = useRef({ width: gridWidth, height: gridHeight });
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "palette" | null>(null);
  const mobileLayersButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilePaletteButtonRef = useRef<HTMLButtonElement | null>(null);
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

      activeLayerPixelsRef.current = resolvedPixels;
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
      layersRef.current = updatedLayers;
      setLayers(updatedLayers);
    },
    [activeLayerId],
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

  const normalizeSelectionRect = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }): SelectionRect => {
      const startX = clampCellX(start.x);
      const startY = clampCellY(start.y);
      const endX = clampCellX(end.x);
      const endY = clampCellY(end.y);
      const minX = Math.min(startX, endX);
      const minY = Math.min(startY, endY);
      const maxX = Math.max(startX, endX);
      const maxY = Math.max(startY, endY);
      const width = Math.min(maxX - minX + 1, gridWidth - minX);
      const height = Math.min(maxY - minY + 1, gridHeight - minY);
      return {
        x: minX,
        y: minY,
        width: Math.max(1, width),
        height: Math.max(1, height),
      };
    },
    [clampCellX, clampCellY, gridHeight, gridWidth],
  );

  const selectionContainsCell = useCallback(
    (sel: SelectionState, cellX: number, cellY: number) => {
      const left = sel.rect.x + sel.offset.dx;
      const top = sel.rect.y + sel.offset.dy;
      return (
        cellX >= left &&
        cellX < left + sel.rect.width &&
        cellY >= top &&
        cellY < top + sel.rect.height
      );
    },
    [],
  );

  const clampSelectionOffset = useCallback(
    (rect: SelectionRect, desired: { dx: number; dy: number }) => {
      const minDx = -(rect.x + rect.width - 1);
      const maxDx = gridWidth - 1 - rect.x;
      const minDy = -(rect.y + rect.height - 1);
      const maxDy = gridHeight - 1 - rect.y;
      return {
        dx: Math.min(Math.max(desired.dx, minDx), maxDx),
        dy: Math.min(Math.max(desired.dy, minDy), maxDy),
      };
    },
    [gridHeight, gridWidth],
  );

  const coordsToIndex = useCallback(
    (x: number, y: number) => y * gridWidth + x,
    [gridWidth],
  );

  const isInBounds = useCallback(
    (x: number, y: number) => x >= 0 && x < gridWidth && y >= 0 && y < gridHeight,
    [gridHeight, gridWidth],
  );

  const captureSelectionPixels = useCallback(
    (rect: SelectionRect, source = activeLayerPixelsRef.current): SelectionPixel[] => {
      const result: SelectionPixel[] = [];
      for (let relY = 0; relY < rect.height; relY += 1) {
        for (let relX = 0; relX < rect.width; relX += 1) {
          const absX = rect.x + relX;
          const absY = rect.y + relY;
          if (!isInBounds(absX, absY)) continue;
          const index = coordsToIndex(absX, absY);
          const color = source[index];
          if (color === null) continue;
          result.push({ relX, relY, color });
        }
      }
      return result;
    },
    [coordsToIndex, isInBounds],
  );

  const applySelectionToLayer = useCallback(
    (target: SelectionState, offset: { dx: number; dy: number }, mode: "apply" | "clear") => {
      if (!target.pixels.length) return;
      setActiveLayerPixels((prev) => {
        const next = [...prev];
        let changed = false;
        for (const pixel of target.pixels) {
          const targetX = target.rect.x + pixel.relX + offset.dx;
          const targetY = target.rect.y + pixel.relY + offset.dy;
          if (!isInBounds(targetX, targetY)) continue;
          const index = coordsToIndex(targetX, targetY);
          const nextValue = mode === "clear" ? null : pixel.color;
          if (next[index] === nextValue) continue;
          next[index] = nextValue;
          changed = true;
        }
        return changed ? next : prev;
      });
    },
    [coordsToIndex, isInBounds, setActiveLayerPixels],
  );
  
  const updateHistoryState = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const clearSelectionState = useCallback(() => {
    setSelection(null);
    setSelectionPreviewRect(null);
    setPathPreview(null);
  }, [setPathPreview, setSelection]);

  const finalizeAction = useCallback(() => {
    if (!actionInProgressRef.current) return;
    const undoStack = undoStackRef.current;
    const lastSnapshot = undoStack[undoStack.length - 1];
    const currentState: LayerSnapshot = {
      layers: cloneLayers(layersRef.current, totalCells),
      activeLayerId,
      selection: cloneSelection(selectionRef.current),
    };
    if (
      lastSnapshot &&
      lastSnapshot.activeLayerId === currentState.activeLayerId &&
      areLayersEqual(lastSnapshot.layers, currentState.layers) &&
      areSelectionsEqual(lastSnapshot.selection, currentState.selection)
    ) {
      undoStack.pop();
    }
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
    updateHistoryState();
  }, [activeLayerId, totalCells, updateHistoryState]);

  const selectionCancelClickRef = useRef(false);

  const releaseSelectionPointerCapture = useCallback(
    (pointerId?: number | null) => {
      const activePointerId = selectionPointerIdRef.current;
      if (activePointerId === null) return;
      if (typeof pointerId === "number" && pointerId !== activePointerId) {
        return;
      }
      const canvas = gridRef.current;
      if (
        canvas &&
        typeof canvas.releasePointerCapture === "function" &&
        canvas.hasPointerCapture?.(activePointerId)
      ) {
        try {
          canvas.releasePointerCapture(activePointerId);
        } catch {
          // ignore release failures
        }
      }
      selectionPointerIdRef.current = null;
    },
    [gridRef],
  );

  const cancelSelection = useCallback(() => {
    const hadDraft = selectionDraftOriginRef.current !== null;
    if (selectionDraftOriginRef.current) {
      selectionDraftOriginRef.current = null;
    }
    if (selectionMoveRef.current) {
      selectionMoveRef.current = null;
    }
    selectionLastPointerCellRef.current = null;
    const current = selectionRef.current;
    if (!current && !hadDraft) {
      return false;
    }
    if (current?.isFloating) {
      applySelectionToLayer(current, current.offset, "apply");
    }
    clearSelectionState();
    releaseSelectionPointerCapture();
    if (selectionActionActiveRef.current) {
      finalizeAction();
      selectionActionActiveRef.current = false;
    }
    selectionCancelClickRef.current = false;
    return true;
  }, [applySelectionToLayer, clearSelectionState, finalizeAction, releaseSelectionPointerCapture]);

  const selectEntireCanvas = useCallback(() => {
    if (gridWidth <= 0 || gridHeight <= 0) {
      return;
    }
    cancelSelection();
    const rect: SelectionRect = {
      x: 0,
      y: 0,
      width: gridWidth,
      height: gridHeight,
    };
    const pixels = captureSelectionPixels(rect);
    setSelection({
      rect,
      offset: { dx: 0, dy: 0 },
      pixels,
      isFloating: false,
    });
    setSelectionPreviewRect(null);
    setPathPreview(null);
  }, [cancelSelection, captureSelectionPixels, gridHeight, gridWidth, setPathPreview, setSelection]);

  const finalizeSelectionMove = useCallback(() => {
    setSelection((current) => {
      if (!current || !current.isFloating) {
        return current;
      }
      applySelectionToLayer(current, current.offset, "apply");
      return {
        ...current,
        rect: {
          ...current.rect,
          x: current.rect.x + current.offset.dx,
          y: current.rect.y + current.offset.dy,
        },
        offset: { dx: 0, dy: 0 },
        isFloating: false,
      };
    });
  }, [applySelectionToLayer, setSelection]);

  const recordSnapshot = useCallback(() => {
    const undoStack = undoStackRef.current;
    const snapshot: LayerSnapshot = {
      layers: cloneLayers(layersRef.current, totalCells),
      activeLayerId,
      selection: cloneSelection(selectionRef.current),
    };
    const lastSnapshot = undoStack[undoStack.length - 1];
    if (
      lastSnapshot &&
      lastSnapshot.activeLayerId === snapshot.activeLayerId &&
      areLayersEqual(lastSnapshot.layers, snapshot.layers) &&
      areSelectionsEqual(lastSnapshot.selection, snapshot.selection)
    ) {
      return;
    }
    if (undoStack.length === MAX_HISTORY) {
      undoStack.shift();
    }
    undoStack.push(snapshot);
    updateHistoryState();
  }, [activeLayerId, totalCells, updateHistoryState]);

  const beginAction = useCallback(() => {
    if (actionInProgressRef.current) return;
    recordSnapshot();
    redoStackRef.current = [];
    updateHistoryState();
    actionInProgressRef.current = true;
    actionModifiedRef.current = false;
  }, [recordSnapshot, updateHistoryState]);

  const setMoveLayerPixels = useCallback((layerId: string, pixels: PixelValue[]) => {
    const index = layersRef.current.findIndex((layer) => layer.id === layerId);
    if (index < 0) return;
    const nextLayers = [...layersRef.current];
    nextLayers[index] = { ...nextLayers[index], pixels };
    layersRef.current = nextLayers;
    setLayers(nextLayers);
    activeLayerPixelsRef.current = pixels;
    setActiveLayerPixelsState(pixels);
  }, []);

  const finishMoveDrag = useCallback((pointerId: number, cancelled: boolean) => {
    const drag = moveDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return false;
    moveDragRef.current = null;
    const canvas = gridRef.current;
    if (canvas?.hasPointerCapture?.(pointerId)) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // The browser may have already released capture.
      }
    }
    const currentLayer = layersRef.current.find((layer) => layer.id === drag.layerId);
    const changed = drag.actionStarted && !!currentLayer && (
      !arePixelsEqual(currentLayer.pixels, drag.sourcePixels) ||
      !areSelectionsEqual(selectionRef.current, drag.sourceSelection)
    );
    if (cancelled || !changed) {
      if (drag.actionStarted) {
        setMoveLayerPixels(drag.layerId, drag.sourcePixels.slice());
        const restoredSelection = cloneSelection(drag.sourceSelection);
        selectionRef.current = restoredSelection;
        setSelection(restoredSelection);
        undoStackRef.current = drag.previousUndo;
        redoStackRef.current = drag.previousRedo;
        actionInProgressRef.current = false;
        actionModifiedRef.current = false;
        updateHistoryState();
      }
      if (cancelled && drag.originalActiveLayerId !== drag.layerId) {
        const originalLayer = layersRef.current.find((layer) => layer.id === drag.originalActiveLayerId);
        if (originalLayer) {
          setActiveLayerId(originalLayer.id);
          activeLayerPixelsRef.current = originalLayer.pixels;
          setActiveLayerPixelsState(originalLayer.pixels);
        }
      }
    } else {
      finalizeAction();
    }
    return true;
  }, [finalizeAction, setMoveLayerPixels, setSelection, updateHistoryState]);

  const deleteSelection = useCallback(() => {
    const current = selectionRef.current;
    if (!current) return;
    if (!current.isFloating && current.pixels.length) {
      beginAction();
      applySelectionToLayer(current, current.offset, "clear");
      finalizeAction();
    } else if (current.isFloating && current.pixels.length) {
      beginAction();
      finalizeAction();
    }
    clearSelectionState();
  }, [applySelectionToLayer, beginAction, clearSelectionState, finalizeAction]);

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
      const maxPreviewSize = 64;
      const scale = Math.max(1, Math.floor(maxPreviewSize / maxDimension));
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
    const query = window.matchMedia("(max-width: 767px)");
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
    return () => {
      pointerQueueRef.current.length = 0;
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

  const baseCellSize = useMemo(() => {
    if (!availableWidth) {
      return canvasPixelSize;
    }
    const maxCellSizeWidth = Math.floor(availableWidth / gridWidth);

    const dimensionCandidates: number[] = [];
    if (Number.isFinite(maxCellSizeWidth) && maxCellSizeWidth > 0) {
      dimensionCandidates.push(maxCellSizeWidth);
    }

    if (availableHeight) {
      const maxCellSizeHeight = Math.floor(availableHeight / gridHeight);
      if (Number.isFinite(maxCellSizeHeight) && maxCellSizeHeight > 0) {
        dimensionCandidates.push(maxCellSizeHeight);
      }
    }

    if (!dimensionCandidates.length) {
      return canvasPixelSize;
    }

    const dimensionLimit = Math.min(...dimensionCandidates);
    const minCellSize = isMobile ? 1 : 4;
    const clamped = Math.max(minCellSize, dimensionLimit);
    return Math.min(canvasPixelSize, clamped);
  }, [
    availableHeight,
    availableWidth,
    canvasPixelSize,
    gridHeight,
    gridWidth,
    isMobile,
  ]);
  const displayCellSize = useMemo(
    () => baseCellSize * zoomScale,
    [baseCellSize, zoomScale],
  );
  const contentWidth = gridWidth * displayCellSize;
  const contentHeight = gridHeight * displayCellSize;
  const renderOffsetX =
    canvasViewport.width > 0 && contentWidth > 0 && contentWidth <= canvasViewport.width
      ? (canvasViewport.width - contentWidth) / 2
      : 0;
  const renderOffsetY =
    canvasViewport.height > 0 && contentHeight > 0 && contentHeight <= canvasViewport.height
      ? (canvasViewport.height - contentHeight) / 2
      : 0;
  const scrollOriginX = canvasScroll.x;
  const scrollOriginY = canvasScroll.y;
  const basePanBoundsX = getPanBounds(contentWidth, canvasViewport.width, renderOffsetX);
  const basePanBoundsY = getPanBounds(contentHeight, canvasViewport.height, renderOffsetY);
  const { min: minPanX, max: maxPanX } = zoomPanException
    ? includePanOffset(basePanBoundsX, canvasScroll.x)
    : basePanBoundsX;
  const { min: minPanY, max: maxPanY } = zoomPanException
    ? includePanOffset(basePanBoundsY, canvasScroll.y)
    : basePanBoundsY;

  const setCanvasScrollLimited = useCallback(
    (next: SetStateAction<{ x: number; y: number }>) => {
      setCanvasScroll((previous) => {
        const resolved = typeof next === "function" ? next(previous) : next;
        const x = Math.min(maxPanX, Math.max(minPanX, resolved.x));
        const y = Math.min(maxPanY, Math.max(minPanY, resolved.y));
        return previous.x === x && previous.y === y ? previous : { x, y };
      });
    },
    [maxPanX, maxPanY, minPanX, minPanY],
  );

  const handleViewportResize = useCallback((size: { width: number; height: number }) => {
    setZoomPanException(false);
    setCanvasViewport((prev) =>
      prev.width === size.width && prev.height === size.height ? prev : size,
    );
  }, []);

  useEffect(() => {
    setZoomPanException(false);
  }, [baseCellSize, gridHeight, gridWidth]);

  useEffect(() => {
    setCanvasScrollLimited((previous) => previous);
  }, [setCanvasScrollLimited]);

  useEffect(() => {
    activeLayerPixelsRef.current = activeLayerPixels;
  }, [activeLayerPixels]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);

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
      activeLayerPixelsRef.current = cloned;
      setActiveLayerPixelsState(cloned);
    }
  }, [activeLayerId, layers]);

  useEffect(() => {
    const composed = composeLayers(layers, totalCells);
    compositePixelsRef.current = composed;
    setCompositePixels(composed);
  }, [layers, totalCells]);

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
      layersRef.current = nextLayers;
      const activeLayer = nextLayers.find(
        (layer) => layer.id === activeLayerId,
      );
      if (activeLayer) {
        const cloned = activeLayer.pixels.slice();
        activeLayerPixelsRef.current = cloned;
        setActiveLayerPixelsState(cloned);
      }
      return nextLayers;
    });

    prevDimensionsRef.current = { width: gridWidth, height: gridHeight };
    undoStackRef.current = [];
    redoStackRef.current = [];
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
    setHoverIndexIfChanged(null);
  }, [
    activeLayerId,
    gridHeight,
    gridWidth,
    setCanRedo,
    setCanUndo,
    setHoverIndexIfChanged,
    totalCells,
  ]);

  useEffect(() => {
    const baseDimension = 32;
    const basePixelSize = 16;
    const largestDimension = Math.max(gridWidth, gridHeight);
    const targetSize = Math.max(
      4,
      Math.round((baseDimension / largestDimension) * basePixelSize),
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
    if (typeof window === "undefined" || !gridWrapperRef.current) {
      return;
    }
    const updateSize = () => {
      const wrapper = gridWrapperRef.current;
      if (!wrapper) return;
      const measuredWidth = wrapper.clientWidth;
      const parentWidth =
        wrapper.parentElement?.clientWidth ?? measuredWidth;
      const measuredHeight = wrapper.clientHeight;
      const parentHeight =
        wrapper.parentElement?.clientHeight ?? measuredHeight;

      setAvailableWidth(parentWidth);

      wrapperParentWidthRef.current = parentWidth;

      setAvailableHeight(parentHeight);

      wrapperParentHeightRef.current = parentHeight;
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(gridWrapperRef.current);
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  useEffect(() => {
    if (tool === "rect-select" || selectionPointerIdRef.current === null) {
      return;
    }
    const canvas = gridRef.current;
    if (
      canvas &&
      typeof canvas.releasePointerCapture === "function" &&
      canvas.hasPointerCapture?.(selectionPointerIdRef.current)
    ) {
      try {
        canvas.releasePointerCapture(selectionPointerIdRef.current);
      } catch {
        // ignore release failures
      }
    }
    selectionPointerIdRef.current = null;
  }, [tool]);

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
    updateHistoryState();
  }, [updateHistoryState]);



  const applySnapshot = useCallback(
    (snapshot: LayerSnapshot) => {
      const restoredLayers = cloneLayers(snapshot.layers, totalCells);
      layersRef.current = restoredLayers;
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
        activeLayerPixelsRef.current = cloned;
        setActiveLayerPixelsState(cloned);
      }
      setSelection(cloneSelection(snapshot.selection));
      setSelectionPreviewRect(null);
      selectionDraftOriginRef.current = null;
      selectionMoveRef.current = null;
      selectionLastPointerCellRef.current = null;
      selectionActionActiveRef.current = false;
      selectionCancelClickRef.current = false;
      releaseSelectionPointerCapture();
    },
    [
      releaseSelectionPointerCapture,
      setActiveLayerPixelsState,
      setSelection,
      setSelectionPreviewRect,
      totalCells,
    ],
  );

  const undo = useCallback(() => {
    if (actionInProgressRef.current) return;
    const undoStack = undoStackRef.current;
    if (!undoStack.length) return;
    const previous = undoStack.pop();
    if (!previous) return;
    const currentSnapshot: LayerSnapshot = {
      layers: cloneLayers(layersRef.current, totalCells),
      activeLayerId,
      selection: cloneSelection(selectionRef.current),
    };
    if (redoStackRef.current.length === MAX_HISTORY) {
      redoStackRef.current.shift();
    }
    redoStackRef.current.push(currentSnapshot);
    applySnapshot(previous);
    setHoverIndexIfChanged(null);
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
    updateHistoryState();
  }, [
    activeLayerId,
    applySnapshot,
    setHoverIndexIfChanged,
    totalCells,
    updateHistoryState,
  ]);

  const redo = useCallback(() => {
    if (actionInProgressRef.current) return;
    const redoStack = redoStackRef.current;
    if (!redoStack.length) return;
    const next = redoStack.pop();
    if (!next) return;
    const currentSnapshot: LayerSnapshot = {
      layers: cloneLayers(layersRef.current, totalCells),
      activeLayerId,
      selection: cloneSelection(selectionRef.current),
    };
    const undoStack = undoStackRef.current;
    if (undoStack.length === MAX_HISTORY) {
      undoStack.shift();
    }
    undoStack.push(currentSnapshot);
    applySnapshot(next);
    setHoverIndexIfChanged(null);
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
    updateHistoryState();
  }, [activeLayerId, applySnapshot, setHoverIndexIfChanged, totalCells, updateHistoryState]);

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

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox"
      );
    };

    const handleSelectionKeys = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "delete" || key === "backspace") {
        if (selectionRef.current) {
          event.preventDefault();
          deleteSelection();
        }
        return;
      }
      if (key === "escape") {
        if (
          selectionRef.current ||
          selectionDraftOriginRef.current ||
          selectionMoveRef.current
        ) {
          event.preventDefault();
          cancelSelection();
        }
        return;
      }
      if (key === "a" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        selectEntireCanvas();
      }
    };
    window.addEventListener("keydown", handleSelectionKeys);
    return () => window.removeEventListener("keydown", handleSelectionKeys);
  }, [cancelSelection, deleteSelection, selectEntireCanvas]);

  const computeBrushIndices = useCallback(
    (centerIndex: number) => {
      const centerX = centerIndex % gridWidth;
      const centerY = Math.floor(centerIndex / gridWidth);
      const startOffset = -Math.floor((brushSize - 1) / 2);
      const endOffset = Math.ceil((brushSize - 1) / 2);
      const indices: number[] = [];

      const circleCenter = (startOffset + endOffset) / 2;
      const radiusSquared = (brushSize / 2) ** 2;

      const minY = Math.max(startOffset, -centerY);
      const maxY = Math.min(endOffset, gridHeight - 1 - centerY);
      const minX = Math.max(startOffset, -centerX);
      const maxX = Math.min(endOffset, gridWidth - 1 - centerX);

      for (let dy = minY; dy <= maxY; dy += 1) {
        for (let dx = minX; dx <= maxX; dx += 1) {
          if (
            brushShape === "circle" &&
            (dx - circleCenter) ** 2 + (dy - circleCenter) ** 2 > radiusSquared
          ) {
            continue;
          }
          indices.push(coordsToIndex(centerX + dx, centerY + dy));
        }
      }

      return indices;
    },
    [brushShape, brushSize, coordsToIndex, gridHeight, gridWidth],
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
        actionModifiedRef.current = true;
      }
    },
    [computeBrushIndices, setActiveLayerPixels],
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

      actionModifiedRef.current = true;
      setActiveLayerPixels(next);
    },
    [computeBrushIndices, setActiveLayerPixels],
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
    (startIndex: number, endIndex: number) => {
      if (startIndex === endIndex) {
        return [startIndex];
      }

      let { x: x0, y: y0 } = indexToCoords(startIndex);
      const { x: x1, y: y1 } = indexToCoords(endIndex);

      const result: number[] = [];

      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;

      while (true) {
        if (isInBounds(x0, y0)) {
          result.push(coordsToIndex(x0, y0));
        }
        if (x0 === x1 && y0 === y1) {
          break;
        }
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x0 += sx;
        }
        if (e2 < dx) {
          err += dx;
          y0 += sy;
        }
      }

      return result;
    },
    [coordsToIndex, indexToCoords, isInBounds],
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
    [setActiveColor, setDrawValue],
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
    (startIndex: number, endIndex: number, shape: ShapeKind, filled: boolean) => {
      const { x: startX, y: startY } = indexToCoords(startIndex);
      const { x: endX, y: endY } = indexToCoords(endIndex);

      const minX = Math.max(0, Math.min(startX, endX));
      const maxX = Math.min(gridWidth - 1, Math.max(startX, endX));
      const minY = Math.max(0, Math.min(startY, endY));
      const maxY = Math.min(gridHeight - 1, Math.max(startY, endY));
      const topToBottom = startY <= endY;

      const width = Math.max(1, maxX - minX + 1);
      const height = Math.max(1, maxY - minY + 1);

      const cells: number[] = [];

      const pushCell = (x: number, y: number) => {
        if (!isInBounds(x, y)) return;
        cells.push(coordsToIndex(x, y));
      };

      const addSquare = () => {
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            pushCell(x, y);
          }
        }
      };

      const addCircle = () => {
        const centerX = minX + (width - 1) / 2;
        const centerY = minY + (height - 1) / 2;
        const radius = Math.max(width, height) / 2;
        for (let y = minY; y <= maxY; y += 1) {
          for (let x = minX; x <= maxX; x += 1) {
            const dx = x - centerX;
            const dy = y - centerY;
            if (dx * dx + dy * dy <= radius * radius) {
              pushCell(x, y);
            }
          }
        }
      };

      const addTriangle = () => {
        const effectiveHeight = Math.max(height - 1, 1);
        const centerX = minX + (width - 1) / 2;
        if (topToBottom) {
          for (let y = minY; y <= maxY; y += 1) {
            const progress = (y - minY) / effectiveHeight;
            const halfSpan = (width - 1) / 2 * (1 - progress);
            const left = Math.round(centerX - halfSpan);
            const right = Math.round(centerX + halfSpan);
            for (let x = left; x <= right; x += 1) {
              pushCell(x, y);
            }
          }
        } else {
          for (let y = maxY; y >= minY; y -= 1) {
            const progress = (maxY - y) / effectiveHeight;
            const halfSpan = (width - 1) / 2 * (1 - progress);
            const left = Math.round(centerX - halfSpan);
            const right = Math.round(centerX + halfSpan);
            for (let x = left; x <= right; x += 1) {
              pushCell(x, y);
            }
          }
        }
      };

      if (shape === "square") {
        addSquare();
      } else if (shape === "circle") {
        addCircle();
      } else {
        addTriangle();
      }

      if (filled) {
        return cells;
      }

      const perimeter = new Set<number>();
      const cellSet = new Set(cells);
      const neighborOffsets = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 },
      ];

      for (const cell of cells) {
        const { x, y } = indexToCoords(cell);
        for (const { dx, dy } of neighborOffsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (!isInBounds(nx, ny) || !cellSet.has(coordsToIndex(nx, ny))) {
            perimeter.add(cell);
            break;
          }
        }
      }

      return Array.from(perimeter);
    },
    [coordsToIndex, gridHeight, gridWidth, indexToCoords, isInBounds],
  );

  const handleCreateLayer = useCallback(() => {
    recordSnapshot();
    redoStackRef.current = [];
    const newLayer: Layer = {
      id: createLayerId(),
      name: generateLayerName(layersRef.current),
      pixels: new Array(totalCells).fill(null) as PixelValue[],
      visible: true,
    };
    const nextLayers = [...layersRef.current, newLayer];
    layersRef.current = nextLayers;
    setLayers(nextLayers);
    setActiveLayerId(newLayer.id);
    setPathPreview(null);
    setHoverIndexIfChanged(null);
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
    updateHistoryState();
  }, [recordSnapshot, setHoverIndexIfChanged, totalCells, updateHistoryState, setPathPreview]);

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const currentLayers = layersRef.current;
      if (currentLayers.length <= 1) {
        return;
      }
      if (!currentLayers.some((layer) => layer.id === layerId)) {
        return;
      }
      recordSnapshot();
      redoStackRef.current = [];
      const nextLayers = currentLayers.filter((layer) => layer.id !== layerId);
      if (!nextLayers.length) return;
      layersRef.current = nextLayers;
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
      actionModifiedRef.current = false;
      actionInProgressRef.current = false;
      updateHistoryState();
    },
    [activeLayerId, recordSnapshot, setHoverIndexIfChanged, setPathPreview, updateHistoryState],
  );

  const handleRenameLayer = useCallback(
    (layerId: string, name: string) => {
      const trimmedName = name.trim();
      const currentLayers = layersRef.current;
      const layer = currentLayers.find((item) => item.id === layerId);
      if (!layer || !trimmedName || layer.name === trimmedName) return;

      recordSnapshot();
      redoStackRef.current = [];
      const nextLayers = currentLayers.map((item) =>
        item.id === layerId ? { ...item, name: trimmedName } : item,
      );
      layersRef.current = nextLayers;
      setLayers(nextLayers);
      updateHistoryState();
    },
    [recordSnapshot, updateHistoryState],
  );

  const handleToggleLayerVisibility = useCallback(
    (layerId: string) => {
      if (!layersRef.current.some((layer) => layer.id === layerId)) {
        return;
      }
      recordSnapshot();
      redoStackRef.current = [];
      const nextLayers = layersRef.current.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
      );
      layersRef.current = nextLayers;
      setLayers(nextLayers);
      actionModifiedRef.current = false;
      actionInProgressRef.current = false;
      updateHistoryState();
    },
    [recordSnapshot, updateHistoryState],
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
      recordSnapshot();
      redoStackRef.current = [];
      const nextLayers = [...currentLayers];
      const [moved] = nextLayers.splice(fromIndex, 1);
      nextLayers.splice(toIndex, 0, moved);
      layersRef.current = nextLayers;
      setLayers(nextLayers);
      actionModifiedRef.current = false;
      actionInProgressRef.current = false;
      updateHistoryState();
    },
    [recordSnapshot, updateHistoryState],
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
    [activeLayerId, setHoverIndexIfChanged],
  );

  const traceWorldSegment = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const cells: number[] = [];
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let steps = distance / RESAMPLE_STEP;
      if (!Number.isFinite(steps)) {
        steps = 0;
      }
      steps = Math.min(MAX_SEGMENT_STEPS, Math.max(1, Math.ceil(steps)));
      let previousIndex: number | null = null;

      for (let step = 0; step <= steps; step += 1) {
        const t = steps === 0 ? 0 : step / steps;
        const sampleX = from.x + dx * t;
        const sampleY = from.y + dy * t;
        const cellX = Math.floor(sampleX);
        const cellY = Math.floor(sampleY);
        if (!isInBounds(cellX, cellY)) continue;
        const currentIndex = coordsToIndex(cellX, cellY);
        if (previousIndex === null) {
          cells.push(currentIndex);
          previousIndex = currentIndex;
          continue;
        }
        if (currentIndex === previousIndex) {
          continue;
        }
        const link = computeLineIndices(previousIndex, currentIndex);
        for (let pos = 1; pos < link.length; pos += 1) {
          cells.push(link[pos]);
        }
        previousIndex = currentIndex;
      }

      return cells;
    },
    [computeLineIndices, coordsToIndex, isInBounds],
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
        actionModifiedRef.current = true;
        return next;
      });
    },
    [computeBrushIndices, setActiveLayerPixels],
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

  const floodFill = useCallback((startIndex: number, fillValue: PixelValue) => {
    let changed = false;
    setActiveLayerPixels((prev) => {
      const targetValue = prev[startIndex];
      if (targetValue === fillValue) {
        return prev;
      }

      const next = [...prev];
      const stack = [startIndex];
      const visited = new Set<number>();

      while (stack.length) {
        const index = stack.pop();
        if (index === undefined || visited.has(index)) continue;
        visited.add(index);

        if (prev[index] !== targetValue) continue;

        next[index] = fillValue;
        changed = true;

        const { x, y } = indexToCoords(index);

        const neighbors = [
          { x: x - 1, y },
          { x: x + 1, y },
          { x, y: y - 1 },
          { x, y: y + 1 },
        ];

        for (const { x: nx, y: ny } of neighbors) {
          if (!isInBounds(nx, ny)) continue;
          stack.push(coordsToIndex(nx, ny));
        }
      }

      if (!changed) {
        return prev;
      }

      return next;
    });

    if (changed) {
      actionModifiedRef.current = true;
    }
  }, [coordsToIndex, indexToCoords, isInBounds, setActiveLayerPixels]);

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

  const resolvePositionFromClientPoint = useCallback(
    (clientX: number, clientY: number, options?: { clamp?: boolean }) => {
      if (!gridRef.current || displayCellSize <= 0) return null;
      const rect = gridRef.current.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;
      if (!Number.isFinite(relativeX) || !Number.isFinite(relativeY)) {
        return null;
      }
      const contentMinX = renderOffsetX - scrollOriginX;
      const contentMinY = renderOffsetY - scrollOriginY;
      const contentMaxX = contentMinX + contentWidth;
      const contentMaxY = contentMinY + contentHeight;
      let adjustedX = relativeX;
      let adjustedY = relativeY;
      const isOutside =
        relativeX < contentMinX ||
        relativeY < contentMinY ||
        relativeX > contentMaxX ||
        relativeY > contentMaxY;
      if (isOutside) {
        if (!options?.clamp) {
          return null;
        }
        adjustedX = Math.min(Math.max(relativeX, contentMinX), contentMaxX);
        adjustedY = Math.min(Math.max(relativeY, contentMinY), contentMaxY);
      }
      const worldX = scrollOriginX + (adjustedX - renderOffsetX);
      const worldY = scrollOriginY + (adjustedY - renderOffsetY);
      return {
        x: worldX / displayCellSize,
        y: worldY / displayCellSize,
      };
    },
    [
      contentHeight,
      contentWidth,
      displayCellSize,
      renderOffsetX,
      renderOffsetY,
      scrollOriginX,
      scrollOriginY,
    ],
  );

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

  const resolvePointerFromPointerEvent = useCallback(
    (event: ReactPointerEvent<Element>, options?: { clamp?: boolean }) =>
      resolvePointerFromClientPoint(event.clientX, event.clientY, options),
    [resolvePointerFromClientPoint],
  );

  const zoomAtClientPoint = useCallback(
    (direction: "in" | "out", steps: number, clientX: number, clientY: number) => {
      const nextScale = Math.min(
        MAX_ZOOM_SCALE,
        Math.max(1, zoomScale + (direction === "in" ? steps : -steps)),
      );
      if (nextScale === zoomScale || !gridRef.current || displayCellSize <= 0) return;
      const position = resolvePositionFromClientPoint(clientX, clientY, { clamp: true });
      if (!position) return;
      const rect = gridRef.current.getBoundingClientRect();
      const pointerX = clientX - rect.left;
      const pointerY = clientY - rect.top;
      const nextCellSize = baseCellSize * nextScale;
      const nextWidth = gridWidth * nextCellSize;
      const nextHeight = gridHeight * nextCellSize;
      const nextOffsetX =
        nextWidth > 0 && nextWidth <= canvasViewport.width
          ? (canvasViewport.width - nextWidth) / 2
          : 0;
      const nextOffsetY =
        nextHeight > 0 && nextHeight <= canvasViewport.height
          ? (canvasViewport.height - nextHeight) / 2
          : 0;

      setZoomScale(nextScale);
      setZoomPanException(true);
      setCanvasScroll({
        x: position.x * nextCellSize + nextOffsetX - pointerX,
        y: position.y * nextCellSize + nextOffsetY - pointerY,
      });
    },
    [
      baseCellSize,
      canvasViewport.height,
      canvasViewport.width,
      displayCellSize,
      gridHeight,
      gridWidth,
      resolvePositionFromClientPoint,
      setZoomScale,
      zoomScale,
    ],
  );

  const handleWheelZoom = useCallback(
    (direction: "in" | "out", steps: number, point: { x: number; y: number }) => {
      zoomAtClientPoint(direction, steps, point.x, point.y);
    },
    [zoomAtClientPoint],
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

  const updateMoveDrag = useCallback((clientX: number, clientY: number, pointerId: number) => {
    const drag = moveDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    const resolved = resolvePointerFromClientPoint(clientX, clientY, { clamp: true });
    if (!resolved) return;
    const dx = resolved.cellX - drag.origin.x;
    const dy = resolved.cellY - drag.origin.y;
    if (dx === drag.delta.dx && dy === drag.delta.dy) return;
    if (!drag.actionStarted) {
      if (dx === 0 && dy === 0) return;
      const undoStack = undoStackRef.current;
      if (undoStack.length === MAX_HISTORY) undoStack.shift();
      undoStack.push({
        layers: cloneLayers(layersRef.current, totalCells),
        activeLayerId: drag.layerId,
        selection: cloneSelection(drag.sourceSelection),
      });
      redoStackRef.current = [];
      actionInProgressRef.current = true;
      actionModifiedRef.current = false;
      updateHistoryState();
      drag.actionStarted = true;
    }
    drag.delta = { dx, dy };
    const nextPixels = dx === 0 && dy === 0
      ? drag.sourcePixels.slice()
      : translatePixels(drag.movePixels, gridWidth, gridHeight, dx, dy);
    setMoveLayerPixels(drag.layerId, nextPixels);

    let nextSelection: SelectionState | null = null;
    if (drag.sourceSelection) {
      if (dx === 0 && dy === 0) {
        nextSelection = cloneSelection(drag.sourceSelection);
      } else {
        const sourceRect = drag.sourceSelection.rect;
        const shiftedX = sourceRect.x + drag.sourceSelection.offset.dx + dx;
        const shiftedY = sourceRect.y + drag.sourceSelection.offset.dy + dy;
        const left = Math.max(0, shiftedX);
        const top = Math.max(0, shiftedY);
        const right = Math.min(gridWidth, shiftedX + sourceRect.width);
        const bottom = Math.min(gridHeight, shiftedY + sourceRect.height);
        if (right > left && bottom > top) {
          const rect = { x: left, y: top, width: right - left, height: bottom - top };
          nextSelection = {
            rect,
            offset: { dx: 0, dy: 0 },
            pixels: captureSelectionPixels(rect, nextPixels),
            isFloating: false,
          };
        }
      }
    }
    selectionRef.current = nextSelection;
    setSelection(nextSelection);
  }, [captureSelectionPixels, gridHeight, gridWidth, resolvePointerFromClientPoint, setMoveLayerPixels, setSelection, totalCells, updateHistoryState]);

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
        const currentSelection = cloneSelection(selectionRef.current);
        let targetLayer = layersRef.current.find((layer) => layer.id === activeLayerId);
        if (autoPickLayer && !currentSelection) {
          for (let layerIndex = layersRef.current.length - 1; layerIndex >= 0; layerIndex -= 1) {
            const candidate = layersRef.current[layerIndex];
            const pixel = candidate.pixels[resolved.index];
            if (candidate.visible && pixel !== null && pixel !== "transparent") {
              targetLayer = candidate;
              break;
            }
          }
        }
        if (!targetLayer) return;
        const sourcePixels = targetLayer.pixels.slice();
        const movePixels = sourcePixels.slice();
        if (currentSelection?.isFloating) {
          for (const pixel of currentSelection.pixels) {
            const x = currentSelection.rect.x + currentSelection.offset.dx + pixel.relX;
            const y = currentSelection.rect.y + currentSelection.offset.dy + pixel.relY;
            if (isInBounds(x, y)) movePixels[coordsToIndex(x, y)] = pixel.color;
          }
        }
        if (targetLayer.id !== activeLayerId) {
          setActiveLayerId(targetLayer.id);
          activeLayerPixelsRef.current = targetLayer.pixels;
          setActiveLayerPixelsState(targetLayer.pixels);
        }
        moveDragRef.current = {
          pointerId: event.pointerId,
          layerId: targetLayer.id,
          originalActiveLayerId: activeLayerId,
          origin: { x: resolved.cellX, y: resolved.cellY },
          delta: { dx: 0, dy: 0 },
          sourcePixels,
          movePixels,
          sourceSelection: currentSelection,
          previousUndo: undoStackRef.current.slice(),
          previousRedo: redoStackRef.current.slice(),
          actionStarted: false,
        };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Window pointer listeners still complete the drag if capture fails.
        }
        return;
      }
      if (tool === "rect-select") {
        const resolved = resolvePointerFromPointerEvent(event, { clamp: true });
        if (!resolved) return;
        const cellX = resolved.cellX;
        const cellY = resolved.cellY;
        const activeSelection = selectionRef.current;

        if (activeSelection && selectionContainsCell(activeSelection, cellX, cellY)) {
          if (typeof event.currentTarget.setPointerCapture === "function") {
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
              selectionPointerIdRef.current = event.pointerId;
            } catch {
              selectionPointerIdRef.current = null;
            }
          }
          selectionDraftOriginRef.current = null;
          selectionMoveRef.current = {
            pointer: { x: cellX, y: cellY },
            startOffset: activeSelection.offset,
          };
          if (activeSelection.pixels.length) {
            beginAction();
            selectionActionActiveRef.current = true;
            if (!activeSelection.isFloating) {
              applySelectionToLayer(activeSelection, activeSelection.offset, "clear");
              setSelection((prev) =>
                prev
                  ? {
                    ...prev,
                    offset: { dx: 0, dy: 0 },
                    isFloating: true,
                  }
                  : prev,
              );
            }
          }
          return;
        }

        if (activeSelection && !selectionContainsCell(activeSelection, cellX, cellY)) {
          cancelSelection();
          selectionCancelClickRef.current = true;
        } else {
          selectionCancelClickRef.current = false;
        }

        if (typeof event.currentTarget.setPointerCapture === "function") {
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
            selectionPointerIdRef.current = event.pointerId;
          } catch {
            selectionPointerIdRef.current = null;
          }
        }

        selectionMoveRef.current = null;
        selectionDraftOriginRef.current = {
          x: clampCellX(resolved.cellX),
          y: clampCellY(resolved.cellY),
        };
        selectionLastPointerCellRef.current = {
          x: selectionDraftOriginRef.current.x,
          y: selectionDraftOriginRef.current.y,
        };
        clearSelectionState();
        const initialRect = {
          x: selectionDraftOriginRef.current.x,
          y: selectionDraftOriginRef.current.y,
          width: 1,
          height: 1,
        };
        setSelectionPreviewRect(initialRect);
        setPathPreview(null);
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
      applySelectionToLayer,
      activeLayerId,
      autoPickLayer,
      buildPreviewFromAppliedCells,
      activeColor,
      applyBrush,
      beginAction,
      buildLinePreview,
      cancelSelection,
      clampCellX,
      clampCellY,
      clearSelectionState,
      computeLineIndices,
      computeShapeCells,
      floodFill,
      gridWidth,
      coordsToIndex,
      isInBounds,
      lastPointedIndex,
      selectionContainsCell,
      previewToolEffects,
      resolvePointerFromPointerEvent,
      pickColorAtIndex,
      setSelection,
      setHoverIndexIfChanged,
      setDrawValue,
      shapeFilled,
      shapeType,
      startStroke,
      tool,
      zoomMode,
      zoomAtClientPoint,
  ],
  );

  const handleSelectionBackgroundPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (tool === "move") return;
      if (
        !selectionRef.current &&
        !selectionDraftOriginRef.current &&
        !selectionMoveRef.current
      ) {
        return;
      }
      event.preventDefault();
      selectionCancelClickRef.current = true;
      cancelSelection();
    },
    [cancelSelection, tool],
  );

  const finalizeRectSelectionPointerUp = useCallback(
    (eventData: { clientX: number; clientY: number; pointerId?: number | null }) => {
      if (tool !== "rect-select") return false;
      const draftStart = selectionDraftOriginRef.current;
      let handled = false;
      if (draftStart) {
        const resolved = resolvePointerFromClientPoint(eventData.clientX, eventData.clientY, {
          clamp: true,
        });
        const fallback = selectionLastPointerCellRef.current ?? draftStart;
        const endCell = resolved
          ? { x: resolved.cellX, y: resolved.cellY }
          : fallback;
        const rect = normalizeSelectionRect(draftStart, endCell);
        selectionDraftOriginRef.current = null;
        selectionLastPointerCellRef.current = null;
        setSelectionPreviewRect(null);
        setPathPreview(null);
        if (selectionCancelClickRef.current) {
          selectionCancelClickRef.current = false;
        } else {
          const pixels = captureSelectionPixels(rect);
          setSelection({
            rect,
            offset: { dx: 0, dy: 0 },
            pixels,
            isFloating: false,
          });
        }
        handled = true;
      } else if (selectionMoveRef.current) {
        selectionMoveRef.current = null;
        finalizeSelectionMove();
        if (selectionActionActiveRef.current) {
          finalizeAction();
          selectionActionActiveRef.current = false;
        }
        setPathPreview(null);
        selectionCancelClickRef.current = false;
        handled = true;
      }
      if (handled) {
        releaseSelectionPointerCapture(eventData.pointerId ?? null);
      }
      return handled;
    },
    [
      captureSelectionPixels,
      finalizeAction,
      finalizeSelectionMove,
      normalizeSelectionRect,
      releaseSelectionPointerCapture,
      resolvePointerFromClientPoint,
      setPathPreview,
      setSelection,
      setSelectionPreviewRect,
      tool,
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

  const updateRectSelectionFromClientPoint = useCallback(
    (clientX: number, clientY: number) => {
      if (tool !== "rect-select") return false;
      const resolved = resolvePointerFromClientPoint(clientX, clientY, {
        clamp: true,
      });
      if (!resolved) return false;
      if (selectionDraftOriginRef.current) {
        selectionLastPointerCellRef.current = {
          x: resolved.cellX,
          y: resolved.cellY,
        };
        const rect = normalizeSelectionRect(selectionDraftOriginRef.current, {
          x: resolved.cellX,
          y: resolved.cellY,
        });
        if (
          selectionCancelClickRef.current &&
          (rect.x !== selectionDraftOriginRef.current.x ||
            rect.y !== selectionDraftOriginRef.current.y ||
            rect.width > 1 ||
            rect.height > 1)
        ) {
          selectionCancelClickRef.current = false;
        }
        setSelectionPreviewRect(rect);
        setPathPreview(null);
      } else if (selectionMoveRef.current && selectionRef.current) {
        const activeSelection = selectionRef.current;
        const deltaX = resolved.cellX - selectionMoveRef.current.pointer.x;
        const deltaY = resolved.cellY - selectionMoveRef.current.pointer.y;
        const desired = {
          dx: selectionMoveRef.current.startOffset.dx + deltaX,
          dy: selectionMoveRef.current.startOffset.dy + deltaY,
        };
        const clamped = clampSelectionOffset(activeSelection.rect, desired);
        setSelection((prev) =>
          prev ? { ...prev, offset: clamped } : prev,
        );
      }
      return true;
    },
    [
      clampSelectionOffset,
      normalizeSelectionRect,
      resolvePointerFromClientPoint,
      setPathPreview,
      setSelection,
      setSelectionPreviewRect,
      tool,
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

      if (tool === "move" && moveDragRef.current) {
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
      clampSelectionOffset,
      normalizeSelectionRect,
      setSelection,
      setHoverIndexIfChanged,
      shapeFilled,
      shapeType,
      tool,
      updateShiftLinePreview,
      updateRectSelectionFromClientPoint,
      updateMoveDrag,
      selectionMoveRef,
      selectionDraftOriginRef,
    ],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      if (ignoredCanvasPointerIdRef.current === event.pointerId) {
        ignoredCanvasPointerIdRef.current = null;
        return;
      }
      if (tool === "move" && moveDragRef.current) {
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
            actionModifiedRef.current = true;
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
      appendStrokePoint,
      applyLinePath,
      commitStrokeBuffer,
      computeLineIndices,
      computeShapeCells,
      dragStartIndex,
      finalizeRectSelectionPointerUp,
      finishMoveDrag,
      flushPointerQueue,
      hoverIndex,
      lastPointedIndex,
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

  useEffect(() => {
    if (tool !== "move") {
      const drag = moveDragRef.current;
      if (drag) finishMoveDrag(drag.pointerId, true);
      return;
    }
    const onMove = (event: PointerEvent) => {
      updateMoveDrag(event.clientX, event.clientY, event.pointerId);
    };
    const onUp = (event: PointerEvent) => {
      updateMoveDrag(event.clientX, event.clientY, event.pointerId);
      finishMoveDrag(event.pointerId, false);
    };
    const onCancel = (event: PointerEvent) => finishMoveDrag(event.pointerId, true);
    const onBlur = () => {
      const drag = moveDragRef.current;
      if (drag) finishMoveDrag(drag.pointerId, true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onBlur);
    };
  }, [finishMoveDrag, tool, updateMoveDrag]);

  const handlePointerLeave = useCallback(() => {
    if (!isDrawingRef.current) {
      setHoverIndexIfChanged(null);
      if (tool === "line" || tool === "shape" || tool === "pencil" || tool === "eraser" || tool === "rect-select") {
        setPathPreview(null);
      }
    }
  }, [setHoverIndexIfChanged, tool]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleGlobalSelectionPointerUp = (clientX: number, clientY: number, pointerId: number | null) => {
      if (
        selectionDraftOriginRef.current === null &&
        selectionMoveRef.current === null
      ) {
        return;
      }
      if (
        selectionPointerIdRef.current !== null &&
        pointerId !== null &&
        pointerId !== selectionPointerIdRef.current
      ) {
        return;
      }
      finalizeRectSelectionPointerUp({
        clientX,
        clientY,
        pointerId,
      });
    };
    const supportsPointerEvents =
      typeof window.PointerEvent !== "undefined";
    if (supportsPointerEvents) {
      const pointerListener = (event: PointerEvent) => {
        handleGlobalSelectionPointerUp(event.clientX, event.clientY, event.pointerId);
      };
      window.addEventListener("pointerup", pointerListener);
      return () => window.removeEventListener("pointerup", pointerListener);
    }
    const mouseListener = (event: MouseEvent) => {
      handleGlobalSelectionPointerUp(event.clientX, event.clientY, null);
    };
    const touchListener = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      handleGlobalSelectionPointerUp(touch.clientX, touch.clientY, null);
    };
    window.addEventListener("mouseup", mouseListener);
    window.addEventListener("touchend", touchListener);
    window.addEventListener("touchcancel", touchListener);
    return () => {
      window.removeEventListener("mouseup", mouseListener);
      window.removeEventListener("touchend", touchListener);
      window.removeEventListener("touchcancel", touchListener);
    };
  }, [finalizeRectSelectionPointerUp]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleMove = (clientX: number, clientY: number, pointerId: number | null) => {
      if (tool !== "rect-select") return;
      if (
        selectionDraftOriginRef.current === null &&
        selectionMoveRef.current === null
      ) {
        return;
      }
      if (
        selectionPointerIdRef.current !== null &&
        pointerId !== null &&
        pointerId !== selectionPointerIdRef.current
      ) {
        return;
      }
      updateRectSelectionFromClientPoint(clientX, clientY);
    };
    const supportsPointerEvents =
      typeof window.PointerEvent !== "undefined";
    if (supportsPointerEvents) {
      const pointerListener = (event: PointerEvent) => {
        handleMove(event.clientX, event.clientY, event.pointerId);
      };
      window.addEventListener("pointermove", pointerListener);
      return () => window.removeEventListener("pointermove", pointerListener);
    }
    const mouseListener = (event: MouseEvent) => {
      handleMove(event.clientX, event.clientY, null);
    };
    const touchListener = (event: TouchEvent) => {
      if (
        selectionDraftOriginRef.current === null &&
        selectionMoveRef.current === null
      ) {
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      handleMove(touch.clientX, touch.clientY, null);
    };
    window.addEventListener("mousemove", mouseListener);
    window.addEventListener("touchmove", touchListener, { passive: false });
    return () => {
      window.removeEventListener("mousemove", mouseListener);
      window.removeEventListener("touchmove", touchListener);
    };
  }, [tool, updateRectSelectionFromClientPoint]);

  // Render matrix once so React keys stay stable.
  const bucketPreview = useMemo(() => {
    if (!previewToolEffects || hoverIndex === null || tool !== "bucket") return null;
    const targetColor = activeLayerPixels[hoverIndex];
    if (targetColor === undefined) return null;

    const visited = new Set<number>();
    const stack = [hoverIndex];
    const region = new Set<number>();

    while (stack.length) {
      const index = stack.pop();
      if (index === undefined || visited.has(index)) continue;
      visited.add(index);

      if (activeLayerPixels[index] !== targetColor) continue;

      region.add(index);

      const { x, y } = indexToCoords(index);

      const neighbors = [
        { x: x - 1, y },
        { x: x + 1, y },
        { x, y: y - 1 },
        { x, y: y + 1 },
      ];

      for (const { x: nx, y: ny } of neighbors) {
        if (!isInBounds(nx, ny)) continue;
        stack.push(coordsToIndex(nx, ny));
      }
    }

    return region;
  }, [activeLayerPixels, coordsToIndex, hoverIndex, indexToCoords, isInBounds, previewToolEffects, tool]);

  const brushPreview = useMemo(() => {
    if (
      brushSizeDragging ||
      !previewToolEffects ||
      hoverIndex === null ||
      (tool !== "pencil" && tool !== "eraser")
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
    recordSnapshot();
    redoStackRef.current = [];
    setLayers((prevLayers) => {
      const clearedLayers = prevLayers.map((layer) => ({
        ...layer,
        pixels: new Array(totalCells).fill(null) as PixelValue[],
      }));
      layersRef.current = clearedLayers;
      const activeLayer = clearedLayers.find(
        (layer) => layer.id === activeLayerId,
      );
      if (activeLayer) {
        const cloned = activeLayer.pixels.slice();
        activeLayerPixelsRef.current = cloned;
        setActiveLayerPixelsState(cloned);
      }
      return clearedLayers;
    });
    setHoverIndexIfChanged(null);
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
    updateHistoryState();
  }, [activeLayerId, recordSnapshot, setActiveLayerPixelsState, setHoverIndexIfChanged, totalCells, updateHistoryState]);



  const handleCloseResetDialog = useCallback(() => {
    setIsResetDialogOpen(false);
  }, []);

  const handleConfirmReset = useCallback(() => {
    setIsResetDialogOpen(false);
    reset();
  }, [reset]);

  const HOTKEYS_MAP = useMemo(
    () => [
      { label: "Select", key: "R" },
      { label: "Move", key: "M" },
      { label: "Pencil", key: "Q" },
      { label: "Eraser", key: "W" },
      { label: "Picker", key: "E" },
      { label: "Magnifier", key: "Z" },
      { label: "Bucket", key: "G" },
      { label: "Shape", key: "S" },
      { label: "Line", key: "L" },
      { label: "Pan Canvas", key: "Two-finger scroll / Middle mouse drag" },
      { label: "Zoom Canvas", key: "Pinch / Mouse wheel / Cmd/Win + Wheel" },
      { label: "Undo", key: "Ctrl/Cmd + Z" },
      { label: "Redo", key: "Ctrl/Cmd + Shift + Z" },
      { label: "Clear", key: "Ctrl/Cmd + Backspace" },
    ],
    [],
  );

  useEffect(() => {
    if (!isResetDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResetDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isResetDialogOpen]);

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

  useEffect(() => {
    if (!isSettingsDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSettingsDialogOpen]);

  useEffect(() => {
    if (!isChangelogDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsChangelogDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isChangelogDialogOpen]);

  const handleCloseHotkeysDialog = useCallback(() => {
    setIsHotkeysDialogOpen(false);
  }, []);

  useEffect(() => {
    if (!isHotkeysDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHotkeysDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHotkeysDialogOpen]);

  useEffect(() => {
    if (!isSaveDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseSaveDialog();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseSaveDialog, isSaveDialogOpen]);

  useEffect(() => {
    const handleGlobalPointerDown = (event: PointerEvent) => {
      const wrapper = gridWrapperRef.current;
      if (!wrapper) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (target instanceof Element && target.closest("[data-pixel-tool], [data-tool-settings]")) return;
      if (!wrapper.contains(target)) {
        cancelSelection();
      }
    };
    window.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => {
      window.removeEventListener("pointerdown", handleGlobalPointerDown);
    };
  }, [cancelSelection]);

  const selectedColorStyles = useMemo(() => {
    const isTransparent = activeColor === "transparent";
    return {
      backgroundColor: isTransparent ? "transparent" : activeColor,
      backgroundImage: isTransparent
        ? "linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db), linear-gradient(45deg, #d1d5db 25%, transparent 25%, transparent 75%, #d1d5db 75%, #d1d5db)"
        : undefined,
      backgroundSize: isTransparent ? "12px 12px" : undefined,
      backgroundPosition: isTransparent ? "0 0, 6px 6px" : undefined,
    };
  }, [activeColor]);

  const closeMobilePanel = useCallback(() => {
    const button = mobilePanel === "layers" ? mobileLayersButtonRef.current : mobilePaletteButtonRef.current;
    setMobilePanel(null);
    button?.focus();
  }, [mobilePanel]);

  useEffect(() => {
    if (!mobilePanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        closeMobilePanel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeMobilePanel, mobilePanel]);

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
        hotkeys={HOTKEYS_MAP}
        isResetDialogOpen={isResetDialogOpen}
        handleCloseResetDialog={handleCloseResetDialog}
        handleConfirmReset={handleConfirmReset}
      />
    </>
  );
}
