import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  TRANSPARENT_DARK,
  TRANSPARENT_LIGHT,
} from "./PixelPencil.constants";
import { PaletteColor, PixelValue } from "./PixelPencilTypes";
import { clampPan, getPanBounds, includePanOffset } from "./canvas-pan";

interface PixelGridProps {
  gridWidth: number;
  gridHeight: number;
  displayCellSize: number;
  gridWrapperRef: MutableRefObject<HTMLDivElement | null>;
  gridRef: MutableRefObject<HTMLCanvasElement | null>;
  pixels: PixelValue[];
  showPixelGrid: boolean;
  checkerSize: number;
  previewToolEffects: boolean;
  dimStrokePreview: boolean;
  bucketPreview: Set<number> | null;
  brushPreview: Set<number> | null;
  brushSizePreview: Set<number> | null;
  pathPreview: Set<number> | null;
  activeColor: PaletteColor;
  drawValueRef: MutableRefObject<PixelValue>;
  drawValueVersion: number;
  tool: string;
  wrapperMaxWidth: number;
  wrapperMaxHeight: number;
  canvasScroll: { x: number; y: number };
  onScrollChange: Dispatch<SetStateAction<{ x: number; y: number }>>;
  onViewportResize: (size: { width: number; height: number }) => void;
  onWheelZoom?: (
    direction: "in" | "out",
    steps: number,
    point: { x: number; y: number },
  ) => void;
  selectionOverlay:
    | {
        rect: { x: number; y: number; width: number; height: number };
        offset: { dx: number; dy: number };
        pixels: { relX: number; relY: number; color: PixelValue }[];
        isFloating: boolean;
      }
    | null;
  selectionPreviewRect: { x: number; y: number; width: number; height: number } | null;
  handlePointerDown: (
    event: ReactPointerEvent<HTMLCanvasElement>,
    index: number,
  ) => void;
  handlePointerEnter: (
    event: ReactPointerEvent<HTMLCanvasElement>,
    index: number,
  ) => void;
  handlePointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handlePointerCancel: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handlePointerLeave: () => void;
  onBackgroundPointerDown?: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
}
const MIN_SCROLLBAR_SIZE = 24;
const VERTICAL_TRACK_MARGIN = 37;
const HORIZONTAL_TRACK_MARGIN = 37;
const VERTICAL_HANDLE_PADDING = 0;
const HORIZONTAL_HANDLE_PADDING = 0;
const SELECTION_BORDER_THICKNESS = 0.1;
const DESK_BACKGROUND = "#18181b";
const ZOOM_WHEEL_THRESHOLD = 60;
const ZOOM_GESTURE_THRESHOLD = 0.15;

type SafariGestureEvent = Event & {
  scale: number;
  clientX?: number;
  clientY?: number;
};

function discreteWheelSteps(event: WheelEvent): number {
  if (event.deltaX !== 0 || event.deltaY === 0) return 0;
  if (event.deltaMode === 1) return Math.max(1, Math.round(Math.abs(event.deltaY) / 3));
  if (event.deltaMode === 2) return Math.max(1, Math.round(Math.abs(event.deltaY)));

  // Browsers expose no device type. Legacy wheelDeltaY identifies wheel notches
  // where available; ambiguous pixel-mode events remain two-finger panning.
  const wheelDeltaY = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
  return wheelDeltaY && Math.abs(wheelDeltaY) >= 120 && Math.abs(wheelDeltaY) % 120 === 0
    ? Math.abs(wheelDeltaY) / 120
    : 0;
}

export function PixelGrid({
  gridWidth,
  gridHeight,
  displayCellSize,
  gridWrapperRef,
  gridRef,
  pixels,
  showPixelGrid,
  checkerSize,
  previewToolEffects,
  dimStrokePreview,
  bucketPreview,
  brushPreview,
  brushSizePreview,
  pathPreview,
  activeColor,
  drawValueRef,
  tool,
  wrapperMaxWidth,
  wrapperMaxHeight,
  canvasScroll,
  onScrollChange,
  onViewportResize,
  onWheelZoom,
  selectionOverlay,
  selectionPreviewRect,
  handlePointerDown,
  handlePointerEnter,
  handlePointerMove,
  handlePointerUp,
  handlePointerCancel,
  handlePointerLeave,
  onBackgroundPointerDown,
  drawValueVersion,
}: PixelGridProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const scrollLockRef = useRef<{ locked: boolean; previousOverflow: string }>(
    { locked: false, previousOverflow: "" },
  );
  const wheelZoomDeltaRef = useRef(0);
  const gestureZoomDeltaRef = useRef(0);
  const gestureScaleRef = useRef<number | null>(null);
  const panGestureRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const contentWidth = Math.max(0, gridWidth * displayCellSize);
  const contentHeight = Math.max(0, gridHeight * displayCellSize);
  const needsHorizontalCenter =
    viewport.width > 0 && contentWidth > 0 && contentWidth <= viewport.width;
  const needsVerticalCenter =
    viewport.height > 0 && contentHeight > 0 && contentHeight <= viewport.height;
  const scrollOriginX = canvasScroll.x;
  const scrollOriginY = canvasScroll.y;
  const renderOffsetX = needsHorizontalCenter
    ? (viewport.width - contentWidth) / 2
    : 0;
  const renderOffsetY = needsVerticalCenter
    ? (viewport.height - contentHeight) / 2
    : 0;
  const panBoundsX = includePanOffset(
    getPanBounds(contentWidth, viewport.width, renderOffsetX),
    canvasScroll.x,
  );
  const panBoundsY = includePanOffset(
    getPanBounds(contentHeight, viewport.height, renderOffsetY),
    canvasScroll.y,
  );
  const panRangeX = panBoundsX.max - panBoundsX.min;
  const panRangeY = panBoundsY.max - panBoundsY.min;

  const assignCanvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      gridRef.current = node;
    },
    [gridRef],
  );

  const getSelectionStyle = useCallback(
    (
      rect: { x: number; y: number; width: number; height: number },
      offset: { dx: number; dy: number } = { dx: 0, dy: 0 },
    ) => {
      const left =
        (rect.x + offset.dx) * displayCellSize - scrollOriginX + renderOffsetX;
      const top =
        (rect.y + offset.dy) * displayCellSize - scrollOriginY + renderOffsetY;
      const width = Math.max(1, rect.width * displayCellSize);
      const height = Math.max(1, rect.height * displayCellSize);
      const halfBorder = SELECTION_BORDER_THICKNESS / 2;
      return {
        left: left - halfBorder,
        top: top - halfBorder,
        width: width + SELECTION_BORDER_THICKNESS,
        height: height + SELECTION_BORDER_THICKNESS,
      };
    },
    [displayCellSize, renderOffsetX, renderOffsetY, scrollOriginX, scrollOriginY],
  );

  const lockBodyScroll = useCallback(() => {
    if (typeof document === "undefined") return;
    if (scrollLockRef.current.locked) return;
    scrollLockRef.current = {
      locked: true,
      previousOverflow: document.body.style.overflow,
    };
    document.body.style.overflow = "hidden";
  }, []);

  const unlockBodyScroll = useCallback(() => {
    if (typeof document === "undefined") return;
    if (!scrollLockRef.current.locked) return;
    document.body.style.overflow = scrollLockRef.current.previousOverflow;
    scrollLockRef.current = { locked: false, previousOverflow: "" };
  }, []);

  useEffect(() => {
    const wrapper = gridWrapperRef.current;
    if (!wrapper) return;
    const updateViewport = () => {
      const width = Math.max(
        0,
        wrapper.clientWidth,
      );
      const height = Math.max(
        0,
        wrapper.clientHeight,
      );
      setViewport((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
      onViewportResize({ width, height });
    };
    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(wrapper);
    return () => resizeObserver.disconnect();
  }, [gridWrapperRef, onViewportResize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (
      gridWidth <= 0 ||
      gridHeight <= 0 ||
      displayCellSize <= 0 ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) return;

    const devicePixelRatio =
      typeof window === "undefined" ? 1 : window.devicePixelRatio ?? 1;

    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    canvas.width = Math.max(1, Math.round(viewportWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(viewportHeight * devicePixelRatio));
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;

    const scaleX = canvas.width / viewportWidth;
    const scaleY = canvas.height / viewportHeight;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = DESK_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);

    const previewColor = drawValueRef.current;
    const hoverColor = tool === "eraser" ? null : activeColor;
    const startX = Math.max(0, Math.floor((scrollOriginX - renderOffsetX) / displayCellSize));
    const endX = Math.min(
      gridWidth,
      Math.ceil((scrollOriginX - renderOffsetX + viewportWidth) / displayCellSize) + 1,
    );
    const startY = Math.max(0, Math.floor((scrollOriginY - renderOffsetY) / displayCellSize));
    const endY = Math.min(
      gridHeight,
      Math.ceil((scrollOriginY - renderOffsetY + viewportHeight) / displayCellSize) + 1,
    );

    const normalizedCheckerSize = Math.max(1, Math.floor(checkerSize));
    // Adjacent cells must share a device-pixel edge. Fractional CSS coordinates
    // let canvas antialias each fill independently and expose hairline seams.
    const xEdges = Array.from({ length: Math.max(0, endX - startX + 1) }, (_, index) =>
      Math.round(
        ((startX + index) * displayCellSize - scrollOriginX + renderOffsetX) *
          scaleX,
      ),
    );
    const yEdges = Array.from({ length: Math.max(0, endY - startY + 1) }, (_, index) =>
      Math.round(
        ((startY + index) * displayCellSize - scrollOriginY + renderOffsetY) *
          scaleY,
      ),
    );
    for (let y = startY; y < endY; y += 1) {
      const cellTop = yEdges[y - startY];
      const cellBottom = yEdges[y - startY + 1];
      for (let x = startX; x < endX; x += 1) {
        const cellLeft = xEdges[x - startX];
        const cellRight = xEdges[x - startX + 1];
        if (cellRight <= 0 || cellBottom <= 0) continue;
        if (cellLeft >= canvas.width || cellTop >= canvas.height) continue;

        const index = y * gridWidth + x;
        const pixel = pixels[index];
        const isTransparent = pixel === null || pixel === "transparent";
        const patternColor =
          (Math.floor(x / normalizedCheckerSize) +
            Math.floor(y / normalizedCheckerSize)) %
            2 === 0
            ? TRANSPARENT_LIGHT
            : TRANSPARENT_DARK;
        const isPathPreviewCell = pathPreview?.has(index) ?? false;
        const showPathPreview = previewToolEffects && isPathPreviewCell;
        const isBucketPreviewCell = tool === "bucket" && (bucketPreview?.has(index) ?? false);
        const isBrushPreviewCell = brushPreview?.has(index) ?? false;
        const showHoverColor = !dimStrokePreview && !showPathPreview &&
          (isBucketPreviewCell || isBrushPreviewCell);
        const previewValue = showPathPreview
          ? previewColor
          : showHoverColor ? hoverColor : null;
        const hasPreviewFill =
          previewValue !== null && previewValue !== "transparent";
        const cellBackgroundColor = showPathPreview || showHoverColor
          ? hasPreviewFill
            ? (previewValue as PaletteColor)
            : patternColor
          : isTransparent
            ? patternColor
            : (pixel as PaletteColor);

        const opacity = dimStrokePreview &&
          (showPathPreview || isBucketPreviewCell || isBrushPreviewCell) ? 0.7 : 1;

        context.globalAlpha = opacity;
        context.fillStyle = cellBackgroundColor;
        context.fillRect(
          cellLeft,
          cellTop,
          cellRight - cellLeft,
          cellBottom - cellTop,
        );
        if (brushSizePreview?.has(index)) {
          context.globalAlpha = 1;
          context.fillStyle = "rgba(24, 24, 27, 0.55)";
          context.fillRect(cellLeft, cellTop, cellRight - cellLeft, cellBottom - cellTop);
          context.fillStyle = "rgba(255, 255, 255, 0.8)";
          const edge = Math.max(1, Math.round(Math.min(scaleX, scaleY)));
          if (!brushSizePreview.has(index - gridWidth)) {
            context.fillRect(cellLeft, cellTop, cellRight - cellLeft, edge);
          }
          if (!brushSizePreview.has(index + gridWidth)) {
            context.fillRect(cellLeft, cellBottom - edge, cellRight - cellLeft, edge);
          }
          if (!brushSizePreview.has(index - 1) || x === 0) {
            context.fillRect(cellLeft, cellTop, edge, cellBottom - cellTop);
          }
          if (!brushSizePreview.has(index + 1) || x === gridWidth - 1) {
            context.fillRect(cellRight - edge, cellTop, edge, cellBottom - cellTop);
          }
        }
      }
    }

    context.globalAlpha = 1;

    if (showPixelGrid) {
      context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      context.save();
      context.beginPath();
      context.rect(renderOffsetX - scrollOriginX, renderOffsetY - scrollOriginY, contentWidth, contentHeight);
      context.clip();
      context.strokeStyle = "rgba(228, 228, 231, 0.8)";
      context.lineWidth = 1;
      for (let column = startX; column <= endX; column += 1) {
        const x =
          column * displayCellSize - scrollOriginX + renderOffsetX + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, viewportHeight);
        context.stroke();
      }
      for (let row = startY; row <= endY; row += 1) {
        const y =
          row * displayCellSize - scrollOriginY + renderOffsetY + 0.5;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(viewportWidth, y);
        context.stroke();
      }
      context.restore();
    }
  }, [
    activeColor,
    brushPreview,
    brushSizePreview,
    bucketPreview,
    canvasScroll.x,
    canvasScroll.y,
    contentHeight,
    contentWidth,
    displayCellSize,
    drawValueRef,
    gridHeight,
    gridWidth,
    pathPreview,
    pixels,
    previewToolEffects,
    dimStrokePreview,
    showPixelGrid,
    tool,
    viewport.height,
    renderOffsetX,
    renderOffsetY,
    scrollOriginX,
    scrollOriginY,
    viewport.width,
    checkerSize,
    drawValueVersion,
  ]);

  const resolveCellIndexFromPoint = useCallback(
    (clientX: number, clientY: number, options?: { clamp?: boolean }) => {
      const canvas = canvasRef.current;
      if (!canvas || displayCellSize <= 0) return null;
      const rect = canvas.getBoundingClientRect();
      const relativeX = clientX - rect.left;
      const relativeY = clientY - rect.top;
      const minX = renderOffsetX - scrollOriginX;
      const minY = renderOffsetY - scrollOriginY;
      const maxX = minX + contentWidth;
      const maxY = minY + contentHeight;
      const isOutside =
        relativeX < minX ||
        relativeY < minY ||
        relativeX > maxX ||
        relativeY > maxY;
      let adjustedX = relativeX;
      let adjustedY = relativeY;
      if (isOutside) {
        if (!options?.clamp) {
          return null;
        }
        adjustedX = Math.min(Math.max(relativeX, minX), maxX);
        adjustedY = Math.min(Math.max(relativeY, minY), maxY);
      }
      const offsetAdjustedX = adjustedX - renderOffsetX;
      const offsetAdjustedY = adjustedY - renderOffsetY;
      const worldX = scrollOriginX + offsetAdjustedX;
      const worldY = scrollOriginY + offsetAdjustedY;
      let cellX = Math.floor(worldX / displayCellSize);
      let cellY = Math.floor(worldY / displayCellSize);
      if (options?.clamp) {
        cellX = Math.min(Math.max(0, cellX), gridWidth - 1);
        cellY = Math.min(Math.max(0, cellY), gridHeight - 1);
      } else if (
        cellX < 0 ||
        cellY < 0 ||
        cellX >= gridWidth ||
        cellY >= gridHeight
      ) {
        return null;
      }
      return cellY * gridWidth + cellX;
    },
    [
      contentHeight,
      contentWidth,
      displayCellSize,
      gridHeight,
      gridWidth,
      renderOffsetX,
      renderOffsetY,
      scrollOriginX,
      scrollOriginY,
    ],
  );

  const resolveCellIndex = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, options?: { clamp?: boolean }) =>
      resolveCellIndexFromPoint(event.clientX, event.clientY, options),
    [
      resolveCellIndexFromPoint,
    ],
  );

  const emitPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>, index: number | null) => {
      if (index === null) {
        if (hoverIndexRef.current !== null) {
          hoverIndexRef.current = null;
          handlePointerLeave();
        }
        return;
      }
      if (hoverIndexRef.current === index) {
        return;
      }
      hoverIndexRef.current = index;
      handlePointerEnter(event, index);
    },
    [handlePointerEnter, handlePointerLeave],
  );

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (panGestureRef.current) return;
      if (event.button === 1) {
        event.preventDefault();
        event.stopPropagation();
        panGestureRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        hoverIndexRef.current = null;
        handlePointerLeave();
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Pointer events on the canvas still work if capture is unavailable.
        }
        return;
      }
      let index = resolveCellIndex(event);
      if (index === null) {
        onBackgroundPointerDown?.(event);
      }
      if (index === null && tool === "rect-select") {
        index = resolveCellIndex(event, { clamp: true });
      }
      if (index === null) return;
      hoverIndexRef.current = index;
      handlePointerDown(event, index);
    },
    [handlePointerDown, handlePointerLeave, onBackgroundPointerDown, resolveCellIndex, tool],
  );

  const handleCanvasPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const gesture = panGestureRef.current;
      if (gesture) {
        if (gesture.pointerId === event.pointerId) {
          const deltaX = event.clientX - gesture.x;
          const deltaY = event.clientY - gesture.y;
          gesture.x = event.clientX;
          gesture.y = event.clientY;
          if (deltaX || deltaY) {
            onScrollChange((previous) => ({
              x: previous.x - deltaX,
              y: previous.y - deltaY,
            }));
          }
        }
        return;
      }
      handlePointerMove(event);
      const index = resolveCellIndex(
        event,
        tool === "rect-select" ? { clamp: true } : undefined,
      );
      emitPointerEnter(event, index);
    },
    [emitPointerEnter, handlePointerMove, onScrollChange, resolveCellIndex, tool],
  );

  const finishPanGesture = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panGestureRef.current?.pointerId !== event.pointerId) return false;
    event.preventDefault();
    panGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    return true;
  }, []);

  const handleCanvasPointerUp = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panGestureRef.current) {
      finishPanGesture(event);
      return;
    }
    handlePointerUp(event);
  }, [finishPanGesture, handlePointerUp]);

  const handleCanvasPointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (panGestureRef.current) {
      finishPanGesture(event);
      return;
    }
    handlePointerCancel(event);
  }, [finishPanGesture, handlePointerCancel]);

  const handleCanvasPointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      lockBodyScroll();
      if (panGestureRef.current) return;
      const index = resolveCellIndex(event);
      emitPointerEnter(event, index);
    },
    [emitPointerEnter, lockBodyScroll, resolveCellIndex],
  );

  const handleCanvasPointerLeave = useCallback(() => {
    unlockBodyScroll();
    hoverIndexRef.current = null;
    handlePointerLeave();
  }, [handlePointerLeave, unlockBodyScroll]);

  useEffect(() => () => unlockBodyScroll(), [unlockBodyScroll]);

  const accumulateZoom = useCallback(
    (remainder: MutableRefObject<number>, delta: number, threshold: number, point: { x: number; y: number }) => {
      if (!onWheelZoom || !Number.isFinite(delta) || delta === 0) return;
      if (remainder.current !== 0 && Math.sign(remainder.current) !== Math.sign(delta)) {
        remainder.current = 0;
      }
      remainder.current += delta;
      const steps = Math.floor(Math.abs(remainder.current) / threshold);
      if (steps === 0) return;
      const direction = remainder.current < 0 ? "in" : "out";
      remainder.current -= steps * threshold * Math.sign(remainder.current);
      onWheelZoom(direction, steps, point);
    },
    [onWheelZoom],
  );

  const handleCanvasWheel = useCallback(
    (event: WheelEvent) => {
      const discreteSteps = discreteWheelSteps(event);
      const wantsZoom = onWheelZoom && (event.metaKey || event.ctrlKey || discreteSteps > 0);
      event.preventDefault();
      if (wantsZoom) {
        const point = { x: event.clientX, y: event.clientY };
        if (discreteSteps > 0) {
          wheelZoomDeltaRef.current = 0;
          onWheelZoom(event.deltaY < 0 ? "in" : "out", discreteSteps, point);
        } else {
          const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
          accumulateZoom(wheelZoomDeltaRef, event.deltaY * unit, ZOOM_WHEEL_THRESHOLD, point);
        }
        return;
      }
      wheelZoomDeltaRef.current = 0;
      if (hoverIndexRef.current !== null) {
        hoverIndexRef.current = null;
        handlePointerLeave();
      }
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
      const deltaX = event.deltaX * unit;
      const deltaY = event.deltaY * unit;
      onScrollChange((previous) => ({ x: previous.x + deltaX, y: previous.y + deltaY }));
    },
    [
      handlePointerLeave,
      accumulateZoom,
      onScrollChange,
      onWheelZoom,
      viewport.height,
    ],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // React's wheel listener is passive, so a native listener is needed to
    // keep browser page zoom from intercepting a canvas pinch gesture.
    canvas.addEventListener("wheel", handleCanvasWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleCanvasWheel);
  }, [handleCanvasWheel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onWheelZoom) return;
    const gesturePoint = (event: SafariGestureEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: Number.isFinite(event.clientX) ? event.clientX! : rect.left + rect.width / 2,
        y: Number.isFinite(event.clientY) ? event.clientY! : rect.top + rect.height / 2,
      };
    };
    const startGesture = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent;
      event.preventDefault();
      gestureScaleRef.current = event.scale > 0 ? event.scale : 1;
      gestureZoomDeltaRef.current = 0;
    };
    const changeGesture = (rawEvent: Event) => {
      const event = rawEvent as SafariGestureEvent;
      event.preventDefault();
      if (gestureScaleRef.current === null || !Number.isFinite(event.scale) || event.scale <= 0) return;
      const previousScale = gestureScaleRef.current;
      gestureScaleRef.current = event.scale;
      accumulateZoom(
        gestureZoomDeltaRef,
        -Math.log(event.scale / previousScale),
        ZOOM_GESTURE_THRESHOLD,
        gesturePoint(event),
      );
    };
    const endGesture = (event: Event) => {
      event.preventDefault();
      gestureScaleRef.current = null;
      gestureZoomDeltaRef.current = 0;
    };
    canvas.addEventListener("gesturestart", startGesture, { passive: false });
    canvas.addEventListener("gesturechange", changeGesture, { passive: false });
    canvas.addEventListener("gestureend", endGesture, { passive: false });
    return () => {
      canvas.removeEventListener("gesturestart", startGesture);
      canvas.removeEventListener("gesturechange", changeGesture);
      canvas.removeEventListener("gestureend", endGesture);
    };
  }, [accumulateZoom, onWheelZoom]);

  const verticalTrackLength = Math.max(
    0,
    viewport.height - VERTICAL_TRACK_MARGIN,
  );
  const horizontalTrackLength = Math.max(
    0,
    viewport.width - HORIZONTAL_TRACK_MARGIN,
  );

  const verticalHandleSize = useMemo(() => {
    if (panRangeY <= 0 || verticalTrackLength <= 0) return 0;
    const ratio = viewport.height / (viewport.height + panRangeY);
    const desired = ratio * verticalTrackLength;
    const maxSize = Math.max(0, verticalTrackLength - VERTICAL_HANDLE_PADDING * 2);
    return Math.min(maxSize, Math.max(MIN_SCROLLBAR_SIZE, desired));
  }, [panRangeY, verticalTrackLength, viewport.height]);

  const horizontalHandleSize = useMemo(() => {
    if (panRangeX <= 0 || horizontalTrackLength <= 0) return 0;
    const ratio = viewport.width / (viewport.width + panRangeX);
    const desired = ratio * horizontalTrackLength;
    const maxSize = Math.max(0, horizontalTrackLength - HORIZONTAL_HANDLE_PADDING * 2);
    return Math.min(maxSize, Math.max(MIN_SCROLLBAR_SIZE, desired));
  }, [horizontalTrackLength, panRangeX, viewport.width]);

  const verticalHandleOffset =
    panRangeY <= 0 || verticalTrackLength <= 0
      ? 0
      : VERTICAL_HANDLE_PADDING +
        ((clampPan(canvasScroll.y, panBoundsY) - panBoundsY.min) / panRangeY) *
          Math.max(1, verticalTrackLength - verticalHandleSize - VERTICAL_HANDLE_PADDING * 2);
  const horizontalHandleOffset =
    panRangeX <= 0 || horizontalTrackLength <= 0
      ? 0
      : HORIZONTAL_HANDLE_PADDING +
        ((clampPan(canvasScroll.x, panBoundsX) - panBoundsX.min) / panRangeX) *
          Math.max(
            1,
            horizontalTrackLength - horizontalHandleSize - HORIZONTAL_HANDLE_PADDING * 2,
          );

  const handleScrollbarPointerDown = useCallback(
    (
      orientation: "horizontal" | "vertical",
      event: ReactPointerEvent<HTMLDivElement>,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const startPointer =
        orientation === "vertical" ? event.clientY : event.clientX;
      const startScroll =
        orientation === "vertical"
          ? clampPan(canvasScroll.y, panBoundsY)
          : clampPan(canvasScroll.x, panBoundsX);
      const handleSize =
        orientation === "vertical" ? verticalHandleSize : horizontalHandleSize;
      const viewportLength =
        orientation === "vertical"
          ? verticalTrackLength
          : horizontalTrackLength;
      const bounds = orientation === "vertical" ? panBoundsY : panBoundsX;
      const panRange = bounds.max - bounds.min;
      if (panRange <= 0 || viewportLength <= 0) {
        return;
      }
      const trackLength = Math.max(1, viewportLength - handleSize);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const pointer =
          orientation === "vertical" ? moveEvent.clientY : moveEvent.clientX;
        const delta = pointer - startPointer;
        const proposed = clampPan(startScroll + (delta / trackLength) * panRange, bounds);
        if (orientation === "vertical") {
          onScrollChange((previous) => ({ x: previous.x, y: proposed }));
        } else {
          onScrollChange((previous) => ({ x: proposed, y: previous.y }));
        }
      };

      const handlePointerUp = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [
      canvasScroll.x,
      canvasScroll.y,
      horizontalHandleSize,
      horizontalTrackLength,
      panBoundsX,
      panBoundsY,
      onScrollChange,
      verticalHandleSize,
      verticalTrackLength,
    ],
  );

  return (
    <>
    <div
      ref={gridWrapperRef}
      className="relative flex h-full w-full min-h-0 touch-none overflow-hidden items-center justify-center"
      style={{
        boxSizing: "border-box",
        maxWidth: wrapperMaxWidth > 0 ? `${wrapperMaxWidth}px` : undefined,
        width: "100%",
        height: wrapperMaxHeight > 0 ? `${wrapperMaxHeight}px` : undefined,
      }}
    >
      <canvas
        ref={assignCanvasRef}
        className="block touch-none select-none focus:outline-none"
        width={Math.max(1, viewport.width)}
        height={Math.max(1, viewport.height)}
        style={{
          width: `${Math.max(1, viewport.width)}px`,
          height: `${Math.max(1, viewport.height)}px`,
          imageRendering: "pixelated",
        }}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerCancel}
        onLostPointerCapture={(event) => {
          if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
        }}
        onAuxClick={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        onPointerEnter={handleCanvasPointerEnter}
        onPointerLeave={handleCanvasPointerLeave}
      />

      {(selectionPreviewRect || selectionOverlay) && (
        <div className="pointer-events-none absolute inset-0">
          {selectionPreviewRect && (
            <div
              className="selection-border selection-border--solid selection-border--preview selection-border--no-fill"
              style={getSelectionStyle(selectionPreviewRect)}
            />
          )}
          {selectionOverlay && (
            <>
              <div
                className="selection-border selection-border--solid"
                style={getSelectionStyle(selectionOverlay.rect, selectionOverlay.offset)}
              />
              {selectionOverlay.isFloating &&
                selectionOverlay.pixels.map((pixel, idx) => {
                  if (pixel.color === null) return null;
                  const absX =
                    selectionOverlay.rect.x + selectionOverlay.offset.dx + pixel.relX;
                  const absY =
                    selectionOverlay.rect.y + selectionOverlay.offset.dy + pixel.relY;
                  const left =
                    absX * displayCellSize - scrollOriginX + renderOffsetX;
                  const top =
                    absY * displayCellSize - scrollOriginY + renderOffsetY;
                  const isTransparent = pixel.color === "transparent";
                  return (
                    <div
                      key={`${absX}-${absY}-${idx}`}
                      className="selection-floating-pixel"
                      style={{
                        left,
                        top,
                        width: displayCellSize,
                        height: displayCellSize,
                        backgroundColor: isTransparent ? "transparent" : (pixel.color as string),
                        backgroundImage: isTransparent
                          ? "linear-gradient(45deg, rgba(0,0,0,0.2) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0.2)), linear-gradient(45deg, rgba(0,0,0,0.2) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.2) 75%, rgba(0,0,0,0.2))"
                          : undefined,
                        backgroundSize: isTransparent ? "6px 6px" : undefined,
                        backgroundPosition: isTransparent ? "0 0, 3px 3px" : undefined,
                      }}
                    />
                  );
                })}
            </>
          )}
        </div>
      )}

      {panRangeY > 0 && verticalHandleSize > 0 && (
        <div className="absolute border-2 border-stone-950 right-2 top-2 bottom-6 w-3 rounded-full bg-zinc-200/60 dark:bg-stone-950">
          <div
            className="absolute left-0 right-0 cursor-pointer rounded-full bg-zinc-500 dark:bg-slate-300"
            style={{
              height: `${verticalHandleSize}px`,
              transform: `translateY(${verticalHandleOffset}px)`,
            }}
            onPointerDown={(event) =>
              handleScrollbarPointerDown("vertical", event)
            }
          />
        </div>
      )}
      {panRangeX > 0 && horizontalHandleSize > 0 && (
        <div className="absolute border-2 border-stone-950 left-2 right-6 bottom-2 h-3 rounded-full bg-zinc-200/60 dark:bg-stone-950">
          <div
            className="absolute top-0 bottom-0 cursor-pointer rounded-full bg-black-500 dark:bg-slate-300"
            style={{
              width: `${horizontalHandleSize}px`,
              transform: `translateX(${horizontalHandleOffset}px)`,
            }}
            onPointerDown={(event) =>
              handleScrollbarPointerDown("horizontal", event)
            }
          />
        </div>
      )}
    </div>
    <style jsx global>{`
      @keyframes pixelSelectionDash {
        from {
          background-position: 0 0, 0 0, 0 100%, 100% 0;
        }
        to {
          background-position: 8px 0, 0 8px, -8px 100%, 100% -8px;
        }
      }

      @keyframes pixelSelectionDashSolid {
        from {
          background-position: 0 0, 0 0, 0 100%, 100% 0, 6px 0, 0 6px, 6px 100%, 100% 6px;
        }
        to {
          background-position: 12px 0, 0 12px, -12px 100%, 100% -12px, 18px 0, 0 18px, -6px 100%, 100% -6px;
        }
      }

      .selection-border {
        position: absolute;
        box-sizing: border-box;
        background-image:
          repeating-linear-gradient(
            90deg,
            rgba(255,255,255,0.95) 0,
            rgba(255,255,255,0.95) 4px,
            transparent 4px,
            transparent 8px
          ),
          repeating-linear-gradient(
            180deg,
            rgba(255,255,255,0.95) 0,
            rgba(255,255,255,0.95) 4px,
            transparent 4px,
            transparent 8px
          ),
          repeating-linear-gradient(
            90deg,
            rgba(15,23,42,0.95) 0,
            rgba(15,23,42,0.95) 4px,
            transparent 4px,
            transparent 8px
          ),
          repeating-linear-gradient(
            180deg,
            rgba(15,23,42,0.95) 0,
            rgba(15,23,42,0.95) 4px,
            transparent 4px,
            transparent 8px
          );
        background-size: 8px 2px, 2px 8px, 8px 2px, 2px 8px;
        background-repeat: repeat-x, repeat-y, repeat-x, repeat-y;
        background-position: 0 0, 0 0, 0 100%, 100% 0;
        animation: pixelSelectionDash 0.5s linear infinite;
      }

      .selection-border--preview {
        opacity: 0.75;
      }

      .selection-border--solid {
        background-image:
          linear-gradient(90deg, rgba(15,23,42,0.9) 50%, transparent 50%),
          linear-gradient(180deg, rgba(15,23,42,0.9) 50%, transparent 50%),
          linear-gradient(90deg, rgba(15,23,42,0.9) 50%, transparent 50%),
          linear-gradient(180deg, rgba(15,23,42,0.9) 50%, transparent 50%),
          linear-gradient(90deg, rgba(255,255,255,0.95) 50%, transparent 50%),
          linear-gradient(180deg, rgba(255,255,255,0.95) 50%, transparent 50%),
          linear-gradient(90deg, rgba(255,255,255,0.95) 50%, transparent 50%),
          linear-gradient(180deg, rgba(255,255,255,0.95) 50%, transparent 50%);
        background-size: 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px, 12px 2px, 2px 12px;
        background-position: 0 0, 0 0, 0 100%, 100% 0, 6px 0, 0 6px, 6px 100%, 100% 6px;
        animation: pixelSelectionDashSolid 0.75s linear infinite;
      }

      .selection-preview-fill {
        position: absolute;
        box-sizing: border-box;
        background: rgba(59, 130, 246, 0.2);
        border: 1px solid rgba(37, 99, 235, 0.9);
        box-shadow:
          inset 0 0 0 1px rgba(37, 99, 235, 0.4),
          0 0 0 1px rgba(15, 23, 42, 0.35);
      }

      .selection-floating-pixel {
        position: absolute;
      }
    `}</style>
  </>
);
}
