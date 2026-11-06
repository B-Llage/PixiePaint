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
  cloneBuffer,
  createBuffer,
  fillMask,
  isBufferEmpty,
  resizeBuffer,
  toPackedValue,
  unpackColor,
  type DirtyRect,
  type PixelBuffer,
} from "./pixel-buffer";
import {
  clearScratchMask,
  collectFillMask,
  computeLineIndices as computeLineIndicesOnGrid,
  computeShapeCells as computeShapeCellsOnGrid,
  scratchPreview,
  stampScratch,
  type PreviewMask,
  type ScratchMask,
} from "./grid-geometry";
import type { OverlayFrame } from "./grid-renderer";
import type { EditLayer } from "./layer-edit";
import { checkerboardStyle } from "./checkerboard";
import { useEscapeKey } from "./hooks/useEscapeKey";
import { useStateWithRef } from "./hooks/useStateWithRef";
import { useEditorHistory, type EditorHistory, type EditorMeta } from "./hooks/useEditorHistory";
import { useComposite } from "./hooks/useComposite";
import { useRedrawSignal } from "./hooks/useRedrawSignal";
import { useCanvasViewport } from "./hooks/useCanvasViewport";
import { useSelectionGestures, useSelectionState } from "./hooks/useSelection";
import { useMoveDrag } from "./hooks/useMoveDrag";
import { useStrokePipeline } from "./hooks/useStrokePipeline";
import { createLayerId, useLayerOperations } from "./hooks/useLayerOperations";
import { useEditorDialogs } from "./hooks/useEditorDialogs";
import { useLayerPreviews } from "./hooks/useLayerPreviews";
import packageJson from "../../../package.json";

const PALETTE_THEMES: readonly PaletteTheme[] = PixelPencilPalettes;

const APP_VERSION = packageJson.version;
// Below Tailwind's `md` breakpoint the Layers and Palette panels become bottom sheets.
const MOBILE_MEDIA_QUERY = "(max-width: 767px)";
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

  // The first layer's id is created once, on mount, and shared by the layer
  // list and the active layer id.
  const [initialLayerId] = useState(() => createLayerId());
  // Layer buffers are mutated in place by `editLayer`; the array itself only
  // changes for structural edits, undo/redo, and resizes.
  const [layers, setLayers, layersRef] = useStateWithRef<Layer[]>(() => [
    {
      id: initialLayerId,
      name: "Layer 1",
      pixels: createBuffer(gridWidth, gridHeight),
      visible: true,
    },
  ]);
  const [activeLayerId, setActiveLayerId, activeLayerIdRef] = useStateWithRef<string>(initialLayerId);
  // Bumps on every pixel or layer change, for consumers keyed on layer contents.
  const [layerVersion, setLayerVersion] = useState(0);
  // Bumps when thumbnails should catch up: after an action ends or the layer list changes.
  const [previewVersion, setPreviewVersion] = useState(0);
  const redrawSignal = useRedrawSignal();
  const { composite, compositeRef, compositeVersion, dirtyRef: compositeDirtyRef, recompose } = useComposite({
    layersRef,
    width: gridWidth,
    height: gridHeight,
    onComposed: redrawSignal.requestRedraw,
  });
  const layerPreviews = useLayerPreviews(layers, gridWidth, gridHeight, previewVersion);
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
  // The hovered cell and the path preview change on every pointer move, so
  // they live in refs and only request a canvas redraw instead of re-rendering
  // the editor. The grid reads them through `getOverlayFrame`.
  const { requestRedraw } = redrawSignal;
  const hoverRef = useRef<number | null>(null);
  const setHoverIndexIfChanged = useCallback(
    (next: number | null) => {
      if (hoverRef.current === next) return;
      hoverRef.current = next;
      requestRedraw();
    },
    [requestRedraw],
  );
  const [lastPointedIndex, setLastPointedIndex] = useState<number | null>(null);
  const {
    isResetDialogOpen,
    isSettingsDialogOpen,
    isChangelogDialogOpen,
    isHotkeysDialogOpen,
    anyDialogOpen,
    openResetDialog: handleOpenResetDialog,
    closeResetDialog: handleCloseResetDialog,
    openSettingsDialog: handleOpenSettingsDialog,
    closeSettingsDialog: handleCloseSettingsDialog,
    openChangelogDialog: handleOpenChangelogDialog,
    closeChangelogDialog: handleCloseChangelogDialog,
    openHotkeysDialog: handleOpenHotkeysDialog,
    closeHotkeysDialog: handleCloseHotkeysDialog,
  } = useEditorDialogs();
  const [zoomMode, setZoomMode] = useState<ZoomMode>("in");
  // The value a stroke paints; the path preview is drawn in it.
  const drawValueRef = useRef<PixelValue>(PALETTE_THEMES[0].colors[0]);
  const setDrawValue = useCallback(
    (value: PixelValue) => {
      if (drawValueRef.current === value) {
        return;
      }
      drawValueRef.current = value;
      requestRedraw();
    },
    [requestRedraw],
  );
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const ignoredCanvasPointerIdRef = useRef<number | null>(null);
  const [dragStartIndex, setDragStartIndex] = useState<number | null>(null);
  const pathPreviewRef = useRef<PreviewMask | null>(null);
  const setPathPreview = useCallback(
    (next: PreviewMask | null) => {
      // A stroke grows its mask in place, so any non-null preview needs a redraw even
      // when its identity is unchanged; only hiding an already hidden preview is a no-op.
      if (next === null && pathPreviewRef.current === null) return;
      pathPreviewRef.current = next;
      requestRedraw();
    },
    [requestRedraw],
  );
  // The grid size the layers' pixel arrays are laid out for; see the resize
  // migration below.
  const [layerDimensions, setLayerDimensions] = useState({ width: gridWidth, height: gridHeight });
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"layers" | "palette" | null>(null);
  const mobileLayersButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilePaletteButtonRef = useRef<HTMLButtonElement | null>(null);
  // `editLayer` needs history, and history needs `restoreSelection` from the
  // selection state that itself takes `editLayer`; the ref breaks the cycle.
  // It is set in an effect, before any pointer or key handler can run.
  const historyRef = useRef<EditorHistory | null>(null);

  const editLayer = useCallback<EditLayer>(
    (layerId, rect, mutate) => {
      const history = historyRef.current;
      const layer = layersRef.current.find((item) => item.id === layerId);
      if (!history || !layer) return null;
      history.capturePixelsBefore(layerId, rect);
      const changed = mutate(layer.pixels);
      if (!changed) return null;
      recompose(changed);
      history.markModified();
      setLayerVersion((version) => version + 1);
      // `capturePixelsBefore` always leaves an action open, so thumbnails catch
      // up when it ends (`finalizeAction`) or on a structure change, not here.
      return changed;
    },
    [layersRef, recompose],
  );

  const getActiveLayer = useCallback(
    () => layersRef.current.find((layer) => layer.id === activeLayerIdRef.current) ?? null,
    [activeLayerIdRef, layersRef],
  );

  const getLayerBuffer = useCallback(
    (layerId: string) => layersRef.current.find((layer) => layer.id === layerId)?.pixels ?? null,
    [layersRef],
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
    getActiveLayer,
    activeLayerId,
    editLayer,
    setPathPreview,
  });
  const {
    selection,
    setSelection,
    selectionRef,
    selectionPreviewRect,
    selectionContainsCell,
    restoreSelection,
  } = selectionState;

  const captureMeta = useCallback(
    (): EditorMeta => ({
      layers: layersRef.current.map(({ id, name, visible }) => ({ id, name, visible })),
      activeLayerId: activeLayerIdRef.current,
      selection: selectionRef.current,
    }),
    [activeLayerIdRef, layersRef, selectionRef],
  );

  // Rebuilds the layer list in `meta`'s order. Layers keep their live buffers
  // unless history handed back a replacement; a layer with neither (redo of an
  // added layer) starts blank and later pixel entries fill it in.
  const applyMeta = useCallback(
    (meta: EditorMeta, buffers: Map<string, PixelBuffer>) => {
      const currentLayers = layersRef.current;
      const liveLayers = new Map(currentLayers.map((layer) => [layer.id, layer]));
      const restoredLayers: Layer[] = meta.layers.map(({ id, name, visible }) => ({
        id,
        name,
        visible,
        pixels: buffers.get(id) ?? liveLayers.get(id)?.pixels ?? createBuffer(gridWidth, gridHeight),
      }));
      // Pixel entries restore their tiles through `onPixelsRestored`; only a
      // different stack (order, visibility, or buffers) needs a full recompose.
      const sameStack =
        buffers.size === 0 &&
        restoredLayers.length === currentLayers.length &&
        restoredLayers.every(
          (layer, index) =>
            layer.id === currentLayers[index].id &&
            layer.visible === currentLayers[index].visible &&
            layer.pixels === currentLayers[index].pixels,
        );
      setLayers(restoredLayers);
      setActiveLayerId(meta.activeLayerId);
      restoreSelection(meta.selection);
      if (!sameStack) recompose(null);
      setLayerVersion((version) => version + 1);
      setPreviewVersion((version) => version + 1);
      setHoverIndexIfChanged(null);
      setPathPreview(null);
    },
    [
      gridHeight,
      gridWidth,
      layersRef,
      recompose,
      restoreSelection,
      setActiveLayerId,
      setHoverIndexIfChanged,
      setLayers,
      setPathPreview,
    ],
  );

  const onPixelsRestored = useCallback(
    (_layerId: string, rect: DirtyRect) => recompose(rect),
    [recompose],
  );

  const history = useEditorHistory({ captureMeta, applyMeta, getLayerBuffer, onPixelsRestored });
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  const {
    canUndo,
    canRedo,
    beginAction,
    finalizeAction: finalizeHistoryAction,
    isActionInProgress,
    recordStructureChange: recordHistoryStructureChange,
    saveStacks,
    restoreStacks,
    clear: clearHistory,
    undo,
    redo,
  } = history;

  // Ending an action that was open is when thumbnails catch up with its edits.
  const finalizeAction = useCallback(() => {
    const wasInProgress = isActionInProgress();
    finalizeHistoryAction();
    if (wasInProgress) setPreviewVersion((version) => version + 1);
  }, [finalizeHistoryAction, isActionInProgress]);

  // Layer-list changes can reorder, hide, add, or remove layers, so the
  // composite is rebuilt in full and the thumbnails refreshed.
  const recordStructureChange = useCallback(
    (apply: () => Map<string, PixelBuffer> | void) => {
      recordHistoryStructureChange(() => {
        const replaced = apply();
        recompose(null);
        setLayerVersion((version) => version + 1);
        setPreviewVersion((version) => version + 1);
        return replaced;
      });
    },
    [recompose, recordHistoryStructureChange],
  );

  const paletteColors = useMemo(
    () => [...currentPalette.colors, "transparent"] as PaletteColor[],
    [currentPalette],
  );

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

  const {
    isOpen: isSaveDialogOpen,
    open: handleOpenSaveDialog,
    close: handleCloseSaveDialog,
    confirmSave: handleConfirmSave,
    exportScale,
    availableScales: exportScales,
    setExportScale: setExportScaleState,
    exportFilename,
    setExportFilename: setExportFilenameState,
    previewDataUrl,
    saveError,
  } = usePixelExport({
    gridWidth,
    gridHeight,
    compositeRef,
    compositeVersion,
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


  // Migrates the artwork when the grid size setting changes, adjusting state
  // during the render that first sees the new size so no frame renders the
  // layers against the wrong dimensions. Pixels keep their top-left anchored
  // position; cells outside the new grid are dropped and new cells are empty.
  // The composite follows on its own: a new size gives it a new buffer that it
  // composes in full. History tiles were taken at the old size, so history is
  // cleared; the effect after the stroke and move hooks drops the hover cell,
  // path preview, stroke and move drag (refs, which render must not write).
  if (layerDimensions.width !== gridWidth || layerDimensions.height !== gridHeight) {
    setLayerDimensions({ width: gridWidth, height: gridHeight });
    setLayers((prevLayers) =>
      prevLayers.map((layer) => ({
        ...layer,
        pixels: resizeBuffer(layer.pixels, gridWidth, gridHeight),
      })),
    );
    setLayerVersion((version) => version + 1);
    setPreviewVersion((version) => version + 1);
    clearHistory();
  }

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

  const {
    isDrawingRef,
    activePointerIdRef,
    computeBrushIndices,
    applyBrush,
    applyLinePath,
    buildLinePreview,
    capturePointer,
    beginDragStroke,
    markLastPainted,
    resetDrawingState,
    resetForGrid,
    beginStroke,
    appendStrokePoint,
    commitStrokeBuffer,
    stopStroke,
    clearPointerQueue,
    flushPointerQueue,
    processDrawingSamples,
  } = useStrokePipeline({
    gridWidth,
    gridHeight,
    tool,
    brushSize,
    brushShape,
    previewToolEffects,
    activeLayerId,
    editLayer,
    setPathPreview,
    setDragStartIndex,
    setDrawValue,
    setHoverIndexIfChanged,
    resolvePointerFromClientPoint,
    finalizeAction,
  });

  // Switching away from the line and shape tools abandons any drag in progress.
  const selectTool = useCallback(
    (next: ToolId) => {
      setTool(next);
      if (next !== "line" && next !== "shape") {
        setDragStartIndex(null);
        setPathPreview(null);
        resetDrawingState();
      }
    },
    [resetDrawingState, setPathPreview],
  );

  useEffect(() => {
    const handleToolHotkeys = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (anyDialogOpen) {
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
      selectTool(match.id);
    };
    window.addEventListener("keydown", handleToolHotkeys);
    return () => window.removeEventListener("keydown", handleToolHotkeys);
  }, [
    anyDialogOpen,
    handleOpenResetDialog,
    selectTool,
  ]);

  const computeLineIndices = useCallback(
    (startIndex: number, endIndex: number) =>
      computeLineIndicesOnGrid({ width: gridWidth, height: gridHeight }, startIndex, endIndex),
    [gridHeight, gridWidth],
  );

  const updateShiftLinePreview = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, targetIndex: number | null) => {
      const supportsShiftLine = tool === "pencil" || tool === "eraser";
      const clearPreview = () => setPathPreview(null);

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
      isDrawingRef,
      lastPointedIndex,
      previewToolEffects,
      setDrawValue,
      setPathPreview,
      tool,
    ],
  );

  const pickColorAtIndex = useCallback(
    (pointerIndex: number) => {
      const value = unpackColor(compositeRef.current.data[pointerIndex]);
      const pickedColor: PaletteColor = value === null ? "transparent" : value;
      setActiveColor(pickedColor);
      setDrawValue(pickedColor);
    },
    [compositeRef, setActiveColor, setDrawValue],
  );

  const computeShapeCells = useCallback(
    (startIndex: number, endIndex: number, shape: ShapeKind, filled: boolean) =>
      computeShapeCellsOnGrid({ width: gridWidth, height: gridHeight }, startIndex, endIndex, shape, filled),
    [gridHeight, gridWidth],
  );

  const {
    createLayer: handleCreateLayer,
    deleteLayer: handleDeleteLayer,
    renameLayer: handleRenameLayer,
    toggleLayerVisibility: handleToggleLayerVisibility,
    reorderLayers: handleReorderLayers,
    selectLayer: handleSelectLayer,
  } = useLayerOperations({
    gridWidth,
    gridHeight,
    layersRef,
    setLayers,
    activeLayerId,
    setActiveLayerId,
    setPathPreview,
    setHoverIndexIfChanged,
    recordStructureChange,
  });

  const floodFill = useCallback(
    (startIndex: number, fillValue: PixelValue) => {
      const layer = getActiveLayer();
      if (!layer) return;
      const packed = toPackedValue(fillValue);
      if (layer.pixels.data[startIndex] === packed) return;
      const region = collectFillMask(layer.pixels, startIndex);
      if (!region) return;
      const { mask, bounds } = region;
      editLayer(layer.id, bounds, (buffer) => fillMask(buffer, mask, bounds, packed));
    },
    [editLayer, getActiveLayer],
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

  const { hasActiveDrag, beginMoveDrag, updateMoveDrag, finishMoveDrag, cancelActiveDrag } = useMoveDrag({
    gridWidth,
    gridHeight,
    tool,
    autoPickLayer,
    gridRef,
    layersRef,
    activeLayerId,
    setActiveLayerId,
    selectionRef,
    setSelection,
    resolvePointerFromClientPoint,
    editLayer,
    getLayerBuffer,
    saveStacks,
    restoreStacks,
    beginAction,
    finalizeAction,
  });

  // A resize invalidates everything laid out for the old grid: an open move drag
  // and stroke hold old-size copies and masks, and the hover cell and path
  // preview index into the old grid. They live in refs, which render must not
  // write, so they are dropped here, right after the render that resized the
  // buffers and before any pointer event can reach them. History was already
  // cleared in render, which also ended any open action.
  useEffect(() => {
    cancelActiveDrag();
    resetForGrid();
    hoverRef.current = null;
    pathPreviewRef.current = null;
    requestRedraw();
  }, [cancelActiveDrag, layerDimensions, requestRedraw, resetForGrid]);

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
      clearPointerQueue();

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
        capturePointer(event.currentTarget, event.pointerId);
        beginDragStroke(strokeColor);
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
        markLastPainted(pointerIndex);
        setPathPreview(null);
        return;
      }

      capturePointer(event.currentTarget, event.pointerId);
      beginStroke(pointerData, strokeColor, tool === "pencil" || tool === "eraser");
    },
    [
      activeColor,
      applyBrush,
      beginAction,
      beginDragStroke,
      beginStroke,
      capturePointer,
      clearPointerQueue,
      beginMoveDrag,
      beginRectSelectGesture,
      buildLinePreview,
      cancelSelection,
      computeLineIndices,
      computeShapeCells,
      floodFill,
      gridWidth,
      lastPointedIndex,
      markLastPainted,
      pickColorAtIndex,
      previewToolEffects,
      resolvePointerFromPointerEvent,
      selectionContainsCell,
      selectionRef,
      setDrawValue,
      setHoverIndexIfChanged,
      setPathPreview,
      shapeFilled,
      shapeType,
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
      isDrawingRef,
      previewToolEffects,
      setHoverIndexIfChanged,
      setPathPreview,
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
      activePointerIdRef,
      buildLinePreview,
      computeLineIndices,
      computeShapeCells,
      dragStartIndex,
      previewToolEffects,
      processDrawingSamples,
      resolvePointerFromClientPoint,
      setHoverIndexIfChanged,
      setPathPreview,
      shapeFilled,
      shapeType,
      tool,
      updateShiftLinePreview,
      hasActiveDrag,
      isDrawingRef,
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
      setLastPointedIndex(pointerUpIndex ?? hoverRef.current ?? lastPointedIndex);

      if (wasDragAction) {
        const eventIndex = resolveIndexFromPointerEvent(event, { clamp: true });
        const endIndex = eventIndex ?? hoverRef.current ?? dragStartIndex;
        if (dragStartIndex !== null && endIndex !== null) {
          const path =
            tool === "line"
              ? computeLineIndices(dragStartIndex, endIndex)
              : computeShapeCells(dragStartIndex, endIndex, shapeType, shapeFilled);
          applyLinePath(path, drawValueRef.current);
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
      activePointerIdRef,
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
      lastPointedIndex,
      resolveIndexFromPointerEvent,
      resolvePointerFromPointerEvent,
      setHoverIndexIfChanged,
      setPathPreview,
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
  }, [isDrawingRef, setHoverIndexIfChanged, setPathPreview, tool]);

  // Scratch masks for the hover and brush-size previews, reused frame to frame
  // and cleared over their last footprint, plus the last bucket fill region.
  const brushPreviewMaskRef = useRef<ScratchMask | null>(null);
  const brushSizeShadowMaskRef = useRef<ScratchMask | null>(null);
  const bucketPreviewCacheRef = useRef<{
    hoverIndex: number;
    layerVersion: number;
    buffer: PixelBuffer;
    mask: PreviewMask | null;
  } | null>(null);

  // Builds the overlay for one frame from the hover and preview refs. The grid
  // calls it on every draw, including redraws that do not re-render the
  // editor, so it reads refs here (never during render).
  const getOverlayFrame = useCallback((): OverlayFrame => {
    const grid = { width: gridWidth, height: gridHeight };
    const cellCount = gridWidth * gridHeight;
    const rawHover = hoverRef.current;
    const hover = rawHover !== null && rawHover >= 0 && rawHover < cellCount ? rawHover : null;
    const drawsBrushPreview =
      tool === "pencil" || tool === "eraser" || tool === "line" || tool === "shape";

    let brush: PreviewMask | null = null;
    if (!brushSizeDragging && previewToolEffects && hover !== null && drawsBrushPreview) {
      const scratch = clearScratchMask(brushPreviewMaskRef.current, grid);
      brushPreviewMaskRef.current = scratch;
      stampScratch(scratch, grid, computeBrushIndices(hover));
      brush = scratchPreview(scratch);
    }

    // The fill region is skipped while drawing and cached per hovered cell and
    // layer contents (the active buffer is mutated in place; `layerVersion`
    // bumps on every edit).
    let bucket: PreviewMask | null = null;
    if (previewToolEffects && tool === "bucket" && hover !== null && !isDrawingRef.current) {
      const layer = getActiveLayer();
      if (layer && layer.pixels.data.length === cellCount) {
        const cached = bucketPreviewCacheRef.current;
        const sameLayer = cached && cached.layerVersion === layerVersion && cached.buffer === layer.pixels;
        if (cached && sameLayer && (cached.hoverIndex === hover || cached.mask?.mask[hover] === 1)) {
          // Same cell, or another cell inside the cached region (same fill region).
          bucket = cached.mask;
        } else {
          bucket = collectFillMask(layer.pixels, hover);
          bucketPreviewCacheRef.current = { hoverIndex: hover, layerVersion, buffer: layer.pixels, mask: bucket };
        }
      }
    }

    // While the brush size field is dragged, a shadow of the brush sits at the
    // center of the visible artwork.
    let brushSizeShadow: PreviewMask | null = null;
    if (brushSizeDragging && canvasViewport.width > 0 && canvasViewport.height > 0) {
      const artworkLeft = renderOffsetX - scrollOriginX;
      const artworkTop = renderOffsetY - scrollOriginY;
      const visibleLeft = Math.max(0, artworkLeft);
      const visibleRight = Math.min(canvasViewport.width, artworkLeft + contentWidth);
      const visibleTop = Math.max(0, artworkTop);
      const visibleBottom = Math.min(canvasViewport.height, artworkTop + contentHeight);
      if (visibleRight > visibleLeft && visibleBottom > visibleTop) {
        const centerX = Math.min(gridWidth - 1, Math.max(0,
          Math.floor(((visibleLeft + visibleRight) / 2 - artworkLeft) / displayCellSize),
        ));
        const centerY = Math.min(gridHeight - 1, Math.max(0,
          Math.floor(((visibleTop + visibleBottom) / 2 - artworkTop) / displayCellSize),
        ));
        const scratch = clearScratchMask(brushSizeShadowMaskRef.current, grid);
        brushSizeShadowMaskRef.current = scratch;
        stampScratch(scratch, grid, computeBrushIndices(centerY * gridWidth + centerX));
        brushSizeShadow = scratchPreview(scratch);
      }
    }

    return {
      path: previewToolEffects ? pathPreviewRef.current : null,
      brush,
      bucket,
      brushSizeShadow,
      pathColor: drawValueRef.current,
      hoverColor: tool === "eraser" ? null : activeColor,
      dim: dimStrokePreview,
    };
  }, [
    activeColor,
    brushSizeDragging,
    canvasViewport.height,
    canvasViewport.width,
    computeBrushIndices,
    contentHeight,
    contentWidth,
    dimStrokePreview,
    displayCellSize,
    getActiveLayer,
    gridHeight,
    gridWidth,
    isDrawingRef,
    layerVersion,
    previewToolEffects,
    renderOffsetX,
    renderOffsetY,
    scrollOriginX,
    scrollOriginY,
    tool,
  ]);

  // Clears every layer in place; history keeps a copy of each buffer for undo.
  const reset = useCallback(() => {
    if (isBufferEmpty(compositeRef.current)) return;
    recordStructureChange(() => {
      const replaced = new Map<string, PixelBuffer>();
      for (const layer of layersRef.current) {
        replaced.set(layer.id, cloneBuffer(layer.pixels));
        layer.pixels.data.fill(0);
      }
      return replaced;
    });
    setHoverIndexIfChanged(null);
  }, [compositeRef, layersRef, recordStructureChange, setHoverIndexIfChanged]);

  const handleConfirmReset = useCallback(() => {
    handleCloseResetDialog();
    reset();
  }, [handleCloseResetDialog, reset]);

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
              onClick={handleOpenHotkeysDialog}
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
            <div className="min-h-0 flex-1 panel-scroll overflow-y-scroll p-4">
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
                  composite={composite}
                  compositeVersion={compositeVersion}
                  compositeDirtyRef={compositeDirtyRef}
                  getOverlayFrame={getOverlayFrame}
                  redraw={redrawSignal}
                  showPixelGrid={showPixelGrid}
                  checkerSize={checkerSize}
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
                  <div className="min-h-0 flex-1 panel-scroll overflow-y-scroll overscroll-contain p-4">
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
                <Toolbox tools={TOOLS} selectedToolId={tool} onSelect={selectTool} />
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
        exportScales={exportScales}
        setExportScale={setExportScaleState}
        exportFilename={exportFilename}
        setExportFilename={setExportFilenameState}
        previewDataUrl={previewDataUrl}
        saveError={saveError}
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
