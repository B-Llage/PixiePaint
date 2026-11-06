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
  SelectionPixel,
  SelectionRect,
  SelectionState,
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
  areSelectionsEqual,
  cloneLayers,
  cloneSelection,
  composeLayers,
  generateLayerName,
  translatePixels,
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
import { useEditorHistory, type HistoryStacks, type LayerSnapshot } from "./hooks/useEditorHistory";
import { useCanvasViewport } from "./hooks/useCanvasViewport";
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

type MoveDrag = {
  pointerId: number;
  layerId: string;
  originalActiveLayerId: string;
  origin: { x: number; y: number };
  delta: { dx: number; dy: number };
  sourcePixels: PixelValue[];
  movePixels: PixelValue[];
  sourceSelection: SelectionState | null;
  previousHistory: HistoryStacks;
  actionStarted: boolean;
};

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
  const [selection, setSelection, selectionRef] = useStateWithRef<SelectionState | null>(null);
  const [selectionPreviewRect, setSelectionPreviewRect] = useState<SelectionRect | null>(null);
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
    [activeLayerPixelsRef, coordsToIndex, isInBounds],
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
  
  const clearSelectionState = useCallback(() => {
    setSelection(null);
    setSelectionPreviewRect(null);
    setPathPreview(null);
  }, [setPathPreview, setSelection]);

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
      setSelection(cloneSelection(snapshot.selection));
      setSelectionPreviewRect(null);
      selectionDraftOriginRef.current = null;
      selectionMoveRef.current = null;
      selectionLastPointerCellRef.current = null;
      selectionActionActiveRef.current = false;
      selectionCancelClickRef.current = false;
      releaseSelectionPointerCapture();
      setHoverIndexIfChanged(null);
    },
    [
      releaseSelectionPointerCapture,
      setActiveLayerPixelsState,
      setHoverIndexIfChanged,
      setLayers,
      setSelection,
      setSelectionPreviewRect,
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
  }, [applySelectionToLayer, clearSelectionState, finalizeAction, releaseSelectionPointerCapture, selectionRef]);

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

  const setMoveLayerPixels = useCallback((layerId: string, pixels: PixelValue[]) => {
    const index = layersRef.current.findIndex((layer) => layer.id === layerId);
    if (index < 0) return;
    const nextLayers = [...layersRef.current];
    nextLayers[index] = { ...nextLayers[index], pixels };
    setLayers(nextLayers);
    setActiveLayerPixelsState(pixels);
  }, [layersRef, setActiveLayerPixelsState, setLayers]);

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
        setSelection(restoredSelection);
        restoreStacks(drag.previousHistory);
      }
      if (cancelled && drag.originalActiveLayerId !== drag.layerId) {
        const originalLayer = layersRef.current.find((layer) => layer.id === drag.originalActiveLayerId);
        if (originalLayer) {
          setActiveLayerId(originalLayer.id);
          setActiveLayerPixelsState(originalLayer.pixels);
        }
      }
    } else {
      finalizeAction();
    }
    return true;
  }, [finalizeAction, layersRef, restoreStacks, selectionRef, setActiveLayerPixelsState, setMoveLayerPixels, setSelection]);

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
  }, [applySelectionToLayer, beginAction, clearSelectionState, finalizeAction, selectionRef]);

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
  }, [cancelSelection, deleteSelection, selectEntireCanvas, selectionRef]);

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
      beginActionWithSnapshot({
        layers: cloneLayers(layersRef.current, totalCells),
        activeLayerId: drag.layerId,
        selection: cloneSelection(drag.sourceSelection),
      });
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
    setSelection(nextSelection);
  }, [beginActionWithSnapshot, captureSelectionPixels, gridHeight, gridWidth, layersRef, resolvePointerFromClientPoint, setMoveLayerPixels, setSelection, totalCells]);

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
          previousHistory: saveStacks(),
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
      activeColor,
      activeLayerId,
      applyBrush,
      applySelectionToLayer,
      autoPickLayer,
      beginAction,
      buildLinePreview,
      buildPreviewFromAppliedCells,
      cancelSelection,
      clampCellX,
      clampCellY,
      clearSelectionState,
      computeLineIndices,
      computeShapeCells,
      coordsToIndex,
      floodFill,
      gridWidth,
      isInBounds,
      lastPointedIndex,
      layersRef,
      pickColorAtIndex,
      previewToolEffects,
      resolvePointerFromPointerEvent,
      saveStacks,
      selectionContainsCell,
      selectionRef,
      setActiveLayerPixelsState,
      setDrawValue,
      setHoverIndexIfChanged,
      setSelection,
      shapeFilled,
      shapeType,
      startStroke,
      tool,
      zoomAtClientPoint,
      zoomMode,
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
    [cancelSelection, selectionRef, tool],
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
      selectionRef,
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
      setHoverIndexIfChanged,
      shapeFilled,
      shapeType,
      tool,
      updateShiftLinePreview,
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
