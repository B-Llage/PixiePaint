import { useCallback, useEffect, useMemo, useState } from "react";
import type { RefObject, SetStateAction } from "react";

import { getPanBounds, includePanOffset } from "../canvas-pan";
import { clampZoomScale, getFitZoomScale, getNextZoomScale } from "../canvas-zoom";
import {
  MAX_ZOOM_SCALE,
  MIN_CELL_SIZE_DESKTOP,
  MIN_CELL_SIZE_MOBILE,
} from "../PixelPencil.constants";

export type ViewportSize = { width: number; height: number };
export type ViewportPoint = { x: number; y: number };
export type ZoomDirection = "in" | "out";

export type CanvasViewportOptions = {
  gridWidth: number;
  gridHeight: number;
  /** The persisted cell size setting; the display size never exceeds it before zoom. */
  canvasPixelSize: number;
  isMobile: boolean;
  /** The grid's wrapper; its parent's size bounds the artwork's display size. */
  gridWrapperRef: RefObject<HTMLDivElement | null>;
  /** The grid canvas; client points are resolved against its bounding rect. */
  gridRef: RefObject<HTMLCanvasElement | null>;
};

export type CanvasViewport = {
  /** The zoom in effect, never below the scale that fits the whole artwork. */
  zoomScale: number;
  /** The scale at which the whole artwork fits the viewport; at most 1. */
  minZoomScale: number;
  availableWidth: number;
  availableHeight: number;
  /** The viewport's size as reported by the grid. */
  canvasViewport: ViewportSize;
  /** The signed pan offset applied to the artwork. */
  canvasScroll: ViewportPoint;
  /** Display size of one cell before zoom. */
  baseCellSize: number;
  /** Display size of one cell after zoom. */
  displayCellSize: number;
  contentWidth: number;
  contentHeight: number;
  /** Centering offset applied when the artwork fits the viewport on that axis. */
  renderOffsetX: number;
  renderOffsetY: number;
  scrollOriginX: number;
  scrollOriginY: number;
  /** Sets the pan offset, clamped to the current pan bounds. */
  setCanvasScroll: (next: SetStateAction<ViewportPoint>) => void;
  handleViewportResize: (size: ViewportSize) => void;
  /**
   * Converts a client point to fractional artwork coordinates in cells.
   * Returns null for points outside the artwork unless `clamp` is set.
   */
  resolvePositionFromClientPoint: (
    clientX: number,
    clientY: number,
    options?: { clamp?: boolean },
  ) => ViewportPoint | null;
  /**
   * Zooms by whole steps above 1x and halvings below it, down to the fit
   * scale, keeping the artwork point under the client point in place. Reaching
   * the fit scale centers the artwork instead.
   */
  zoomAtClientPoint: (direction: ZoomDirection, steps: number, clientX: number, clientY: number) => void;
  handleWheelZoom: (direction: ZoomDirection, steps: number, point: ViewportPoint) => void;
};

/**
 * Viewport, zoom, and pan state for the editor canvas.
 *
 * It measures the space available to the grid, derives the display cell size
 * and the artwork's centered render offset, keeps the pan offset within the
 * shared `canvas-pan` bounds, and anchors zoom around a client point. A zoom
 * may place the offset outside the usual bounds; that exception is kept until
 * the viewport, cell size, or grid size changes. The stored offset is clamped
 * on read, so a bounds change never shows an out-of-range offset.
 */
export function useCanvasViewport({
  gridWidth,
  gridHeight,
  canvasPixelSize,
  isMobile,
  gridWrapperRef,
  gridRef,
}: CanvasViewportOptions): CanvasViewport {
  const [zoomScale, setZoomScale] = useState(1);
  const [availableWidth, setAvailableWidth] = useState<number>(0);
  const [availableHeight, setAvailableHeight] = useState<number>(0);
  const [storedScroll, setStoredScroll] = useState<ViewportPoint>({ x: 0, y: 0 });
  // A zoom may leave the offset outside the usual pan range. The exception is
  // tied to the cell size and grid size it was created under, so it lapses
  // when either changes, and it is cleared explicitly on viewport resize.
  const [panExceptionKey, setPanExceptionKey] = useState<string | null>(null);
  const [canvasViewport, setCanvasViewport] = useState<ViewportSize>({ width: 0, height: 0 });

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
    const minCellSize = isMobile ? MIN_CELL_SIZE_MOBILE : MIN_CELL_SIZE_DESKTOP;
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
  // The smallest zoom shows the whole artwork, however large the grid or
  // narrow the viewport. A stored scale below a newly larger fit is raised.
  const minZoomScale = getFitZoomScale(
    gridWidth,
    gridHeight,
    canvasViewport.width,
    canvasViewport.height,
    baseCellSize,
  );
  const effectiveZoomScale = clampZoomScale(zoomScale, minZoomScale, MAX_ZOOM_SCALE);
  const displayCellSize = useMemo(
    () => baseCellSize * effectiveZoomScale,
    [baseCellSize, effectiveZoomScale],
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
  const panKey = `${baseCellSize}:${gridWidth}:${gridHeight}`;
  const zoomPanException = panExceptionKey === panKey;
  const basePanBoundsX = getPanBounds(contentWidth, canvasViewport.width, renderOffsetX);
  const basePanBoundsY = getPanBounds(contentHeight, canvasViewport.height, renderOffsetY);
  const { min: minPanX, max: maxPanX } = zoomPanException
    ? includePanOffset(basePanBoundsX, storedScroll.x)
    : basePanBoundsX;
  const { min: minPanY, max: maxPanY } = zoomPanException
    ? includePanOffset(basePanBoundsY, storedScroll.y)
    : basePanBoundsY;

  const clampScroll = useCallback(
    (point: ViewportPoint): ViewportPoint => {
      const x = Math.min(maxPanX, Math.max(minPanX, point.x));
      const y = Math.min(maxPanY, Math.max(minPanY, point.y));
      return point.x === x && point.y === y ? point : { x, y };
    },
    [maxPanX, maxPanY, minPanX, minPanY],
  );

  const canvasScroll = useMemo(() => clampScroll(storedScroll), [clampScroll, storedScroll]);
  const scrollOriginX = canvasScroll.x;
  const scrollOriginY = canvasScroll.y;

  const setCanvasScrollLimited = useCallback(
    (next: SetStateAction<ViewportPoint>) => {
      setStoredScroll((previous) => {
        const resolved = typeof next === "function" ? next(clampScroll(previous)) : next;
        const clamped = clampScroll(resolved);
        return previous.x === clamped.x && previous.y === clamped.y ? previous : clamped;
      });
    },
    [clampScroll],
  );

  const handleViewportResize = useCallback((size: ViewportSize) => {
    setPanExceptionKey(null);
    setCanvasViewport((prev) =>
      prev.width === size.width && prev.height === size.height ? prev : size,
    );
  }, []);

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
      setAvailableHeight(parentHeight);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(gridWrapperRef.current);
    window.addEventListener("resize", updateSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSize);
    };
  }, [gridWrapperRef]);

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
      gridRef,
      renderOffsetX,
      renderOffsetY,
      scrollOriginX,
      scrollOriginY,
    ],
  );

  const zoomAtClientPoint = useCallback(
    (direction: ZoomDirection, steps: number, clientX: number, clientY: number) => {
      const nextScale = getNextZoomScale(
        effectiveZoomScale,
        direction,
        steps,
        minZoomScale,
        MAX_ZOOM_SCALE,
      );
      if (nextScale === effectiveZoomScale || !gridRef.current || displayCellSize <= 0) return;
      if (nextScale < 1 && nextScale === minZoomScale) {
        // The fit zoom exists to show the whole artwork, so center it rather
        // than keep the cursor anchor, which could push an edge out of view.
        setZoomScale(nextScale);
        setPanExceptionKey(null);
        setStoredScroll({ x: 0, y: 0 });
        return;
      }
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
      setPanExceptionKey(panKey);
      setStoredScroll({
        x: position.x * nextCellSize + nextOffsetX - pointerX,
        y: position.y * nextCellSize + nextOffsetY - pointerY,
      });
    },
    [
      baseCellSize,
      canvasViewport.height,
      canvasViewport.width,
      displayCellSize,
      effectiveZoomScale,
      gridHeight,
      gridRef,
      gridWidth,
      minZoomScale,
      panKey,
      resolvePositionFromClientPoint,
    ],
  );

  const handleWheelZoom = useCallback(
    (direction: ZoomDirection, steps: number, point: ViewportPoint) => {
      zoomAtClientPoint(direction, steps, point.x, point.y);
    },
    [zoomAtClientPoint],
  );

  return {
    zoomScale: effectiveZoomScale,
    minZoomScale,
    availableWidth,
    availableHeight,
    canvasViewport,
    canvasScroll,
    baseCellSize,
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
  };
}
