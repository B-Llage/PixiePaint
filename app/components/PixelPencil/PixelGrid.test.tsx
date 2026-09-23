import { useRef, useState } from "react";
import type { MutableRefObject, SetStateAction } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixelGrid } from "./PixelGrid";
import type { PixelValue } from "./PixelPencilTypes";
import { clampPan, getPanBounds, includePanOffset } from "./canvas-pan";

const pointerDown = vi.fn();
const pointerMove = vi.fn();
const pointerUp = vi.fn();
const pointerCancel = vi.fn();
const backgroundDown = vi.fn();
const wheelZoom = vi.fn();
const viewportResize = vi.fn();

function GridHarness({ width = 4, height = 4, viewportSize = 100, initialScroll = { x: 0, y: 0 }, brushSizePreview = null, pathPreview = null, brushPreview = null, bucketPreview = null, activeColor = "#ff0000", paintedPixel = null, dimStrokePreview = false, tool = "pencil" }: { width?: number; height?: number; viewportSize?: number; initialScroll?: { x: number; y: number }; brushSizePreview?: Set<number> | null; pathPreview?: Set<number> | null; brushPreview?: Set<number> | null; bucketPreview?: Set<number> | null; activeColor?: string; paintedPixel?: PixelValue; dimStrokePreview?: boolean; tool?: string }) {
  const [scroll, setScroll] = useState(initialScroll);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const drawValueRef = useRef<PixelValue>("#000000");
  const pixels = Array<PixelValue>(width * height).fill(null);
  if (pixels.length > 5) pixels[5] = paintedPixel;
  const contentWidth = width * 10;
  const contentHeight = height * 10;
  const boundsX = includePanOffset(getPanBounds(contentWidth, viewportSize, contentWidth <= viewportSize ? (viewportSize - contentWidth) / 2 : 0), scroll.x);
  const boundsY = includePanOffset(getPanBounds(contentHeight, viewportSize, contentHeight <= viewportSize ? (viewportSize - contentHeight) / 2 : 0), scroll.y);
  const changeScroll = (update: SetStateAction<{ x: number; y: number }>) => {
    setScroll((previous) => {
      const next = typeof update === "function" ? update(previous) : update;
      return { x: clampPan(next.x, boundsX), y: clampPan(next.y, boundsY) };
    });
  };

  return (
    <>
      <output data-testid="scroll">{JSON.stringify(scroll)}</output>
      <PixelGrid
        gridWidth={width}
        gridHeight={height}
        displayCellSize={10}
        gridWrapperRef={gridWrapperRef as MutableRefObject<HTMLDivElement | null>}
        gridRef={gridRef as MutableRefObject<HTMLCanvasElement | null>}
        pixels={pixels}
        showPixelGrid={false}
        checkerSize={1}
        previewToolEffects={pathPreview !== null || brushPreview !== null || bucketPreview !== null}
        dimStrokePreview={dimStrokePreview}
        bucketPreview={bucketPreview}
        brushPreview={brushPreview}
        brushSizePreview={brushSizePreview}
        pathPreview={pathPreview}
        activeColor={activeColor}
        drawValueRef={drawValueRef}
        drawValueVersion={0}
        tool={tool}
        wrapperMaxWidth={viewportSize}
        wrapperMaxHeight={viewportSize}
        canvasScroll={scroll}
        onScrollChange={changeScroll}
        onViewportResize={viewportResize}
        onWheelZoom={wheelZoom}
        selectionOverlay={null}
        selectionPreviewRect={null}
        handlePointerDown={pointerDown}
        handlePointerEnter={vi.fn()}
        handlePointerMove={pointerMove}
        handlePointerUp={pointerUp}
        handlePointerCancel={pointerCancel}
        handlePointerLeave={vi.fn()}
        onBackgroundPointerDown={backgroundDown}
      />
    </>
  );
}

function scrollPosition() {
  return JSON.parse(screen.getByTestId("scroll").textContent ?? "{}") as { x: number; y: number };
}

function dispatchWheel(canvas: HTMLCanvasElement, init: WheelEventInit, wheelDeltaY?: number) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  if (wheelDeltaY !== undefined) {
    Object.defineProperty(event, "wheelDeltaY", { value: wheelDeltaY });
  }
  fireEvent(canvas, event);
  return event;
}

function dispatchGesture(canvas: HTMLCanvasElement, type: string, scale: number, x = 37.5, y = 48.25) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    scale: { value: scale },
    clientX: { value: x },
    clientY: { value: y },
  });
  fireEvent(canvas, event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe(element: Element) {
      const viewportSize = Number.parseFloat((element as HTMLElement).style.height) || 100;
      Object.defineProperties(element, {
        clientWidth: { configurable: true, value: viewportSize },
        clientHeight: { configurable: true, value: viewportSize },
      });
      this.callback();
    }
    disconnect() {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100,
    x: 0, y: 0, toJSON: () => ({}),
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  });
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
  HTMLCanvasElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PixelGrid panning", () => {
  it.each(["pencil", "bucket"])("shows the selected color in the %s hover preview unless dimming is enabled", (tool) => {
    const draws: { color: string; alpha: number; x: number; y: number }[] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect(x: number, y: number) {
        draws.push({ color: context.fillStyle, alpha: context.globalAlpha, x, y });
      },
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const hoverPreview = new Set([5]);
    const props = tool === "bucket" ? { bucketPreview: hoverPreview } : { brushPreview: hoverPreview };
    const { rerender } = render(<GridHarness tool={tool} paintedPixel="#123456" activeColor="#ff8800" {...props} />);

    expect(draws).toContainEqual({ color: "#ff8800", alpha: 1, x: 40, y: 40 });

    draws.length = 0;
    rerender(<GridHarness tool={tool} paintedPixel="#123456" activeColor="#ff8800" dimStrokePreview {...props} />);
    expect(draws).toContainEqual({ color: "#123456", alpha: 0.7, x: 40, y: 40 });
  });

  it.each(["eraser", "transparent"])("shows the checkerboard for %s hover previews", (preview) => {
    const draws: { color: string; alpha: number; x: number; y: number }[] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect(x: number, y: number) {
        draws.push({ color: context.fillStyle, alpha: context.globalAlpha, x, y });
      },
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    render(<GridHarness tool={preview === "eraser" ? "eraser" : "pencil"} activeColor={preview === "transparent" ? "transparent" : "#ff0000"} paintedPixel="#123456" brushPreview={new Set([5])} />);

    expect(draws).toContainEqual({ color: "#d4d4d8", alpha: 1, x: 40, y: 40 });
  });

  it.each(["pencil", "line", "shape"])("renders %s stroke colors at full strength unless dimming is enabled", (tool) => {
    const draws: { color: string; alpha: number; x: number; y: number }[] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect(x: number, y: number) {
        draws.push({ color: context.fillStyle, alpha: context.globalAlpha, x, y });
      },
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const pathPreview = new Set([5]);
    const brushPreview = tool === "pencil" ? new Set([5]) : null;
    const { rerender } = render(<GridHarness tool={tool} pathPreview={pathPreview} brushPreview={brushPreview} />);

    expect(draws).toContainEqual({ color: "#000000", alpha: 1, x: 40, y: 40 });

    draws.length = 0;
    rerender(<GridHarness tool={tool} pathPreview={pathPreview} brushPreview={brushPreview} dimStrokePreview />);
    expect(draws).toContainEqual({ color: "#000000", alpha: 0.7, x: 40, y: 40 });
  });

  it("renders the brush size drag preview as a translucent shadow with a light edge", () => {
    const draws: { color: string; x: number; y: number; width: number; height: number }[] = [];
    const context = {
      fillStyle: "",
      globalAlpha: 1,
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect(x: number, y: number, width: number, height: number) {
        draws.push({ color: context.fillStyle, x, y, width, height });
      },
    };
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context as unknown as CanvasRenderingContext2D);
    render(<GridHarness brushSizePreview={new Set([5])} />);

    expect(draws).toContainEqual({ color: "rgba(24, 24, 27, 0.55)", x: 40, y: 40, width: 10, height: 10 });
    expect(draws.some((draw) => draw.color === "rgba(255, 255, 255, 0.8)" && draw.x === 40 && draw.y === 40)).toBe(true);
  });

  it("renders fitted artwork at its centered base position and keeps a strip visible at the pan limit", () => {
    const fillRect = vi.fn();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect,
    } as unknown as CanvasRenderingContext2D);
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    expect(fillRect).toHaveBeenCalledWith(30, 30, 10, 10);

    fillRect.mockClear();
    fireEvent.wheel(canvas, { deltaX: -20, deltaY: -20 });
    expect(fillRect).toHaveBeenCalledWith(50, 50, 10, 10);

    fillRect.mockClear();
    fireEvent.wheel(canvas, { deltaX: 120, deltaY: 120 });
    expect(scrollPosition()).toEqual({ x: 30, y: 30 });
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 100);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  it("limits two-finger panning in both directions and maps pointers to the shifted canvas", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;

    // A 40 px artwork starts centered within the 100 px viewport.
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 35, clientY: 35 });
    expect(pointerDown).toHaveBeenLastCalledWith(expect.anything(), 0);
    pointerDown.mockClear();

    fireEvent.wheel(canvas, { deltaX: 90, deltaY: 80, deltaMode: 0 });
    expect(scrollPosition()).toEqual({ x: 30, y: 30 });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 80 });
    expect(pointerDown).not.toHaveBeenCalled();
    expect(backgroundDown).toHaveBeenCalled();

    fireEvent.wheel(canvas, { deltaX: -110, deltaY: -100, deltaMode: 0 });
    expect(scrollPosition()).toEqual({ x: -30, y: -30 });
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 65, clientY: 65 });
    expect(pointerDown).toHaveBeenLastCalledWith(expect.anything(), 0);
  });

  it("pans with middle-button drag without forwarding the gesture to drawing", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;

    fireEvent.pointerDown(canvas, { button: 1, pointerId: 7, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(canvas, { buttons: 4, pointerId: 7, clientX: 70, clientY: 35 });
    expect(scrollPosition()).toEqual({ x: -20, y: 15 });
    expect(pointerDown).not.toHaveBeenCalled();
    expect(pointerMove).not.toHaveBeenCalled();
    expect(backgroundDown).not.toHaveBeenCalled();
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);

    fireEvent.pointerUp(canvas, { button: 1, pointerId: 7 });
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(pointerUp).not.toHaveBeenCalled();
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 72, clientY: 35 });
    expect(pointerMove).toHaveBeenCalledTimes(1);
  });

  it("ends a cancelled middle-button drag without cancelling an artwork tool", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.pointerDown(canvas, { button: 1, pointerId: 8, clientX: 50, clientY: 50 });
    fireEvent.pointerCancel(canvas, { pointerId: 8 });
    fireEvent.pointerMove(canvas, { pointerId: 8, clientX: 70, clientY: 70 });
    expect(scrollPosition()).toEqual({ x: 0, y: 0 });
    expect(pointerCancel).not.toHaveBeenCalled();
    expect(pointerMove).toHaveBeenCalledTimes(1);
  });

  it("keeps Meta plus wheel zoom separate from panning", () => {
    const { container } = render(<GridHarness />);
    fireEvent.wheel(container.querySelector("canvas")!, {
      metaKey: true, deltaY: -60, clientX: 35, clientY: 35,
    });
    expect(wheelZoom).toHaveBeenCalledWith("in", 1, { x: 35, y: 35 });
    expect(scrollPosition()).toEqual({ x: 0, y: 0 });
  });

  it("passes all accumulated wheel steps with the cursor point", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.wheel(canvas, { metaKey: true, deltaY: -150, clientX: 37.5, clientY: 48.25 });
    expect(wheelZoom).toHaveBeenCalledWith("in", 2, { x: 37.5, y: 48.25 });
    fireEvent.wheel(canvas, { metaKey: true, deltaY: 90, clientX: 37.5, clientY: 48.25 });
    expect(wheelZoom).toHaveBeenLastCalledWith("out", 1, { x: 37.5, y: 48.25 });
  });

  it("zooms for Chromium pinch wheel events without panning or browser zoom", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    const first = dispatchWheel(canvas, { ctrlKey: true, deltaY: -35, clientX: 37.5, clientY: 48.25 });
    expect(wheelZoom).not.toHaveBeenCalled();
    const second = dispatchWheel(canvas, { ctrlKey: true, deltaY: -35, clientX: 37.5, clientY: 48.25 });
    expect(wheelZoom).toHaveBeenCalledWith("in", 1, { x: 37.5, y: 48.25 });
    dispatchWheel(canvas, { ctrlKey: true, deltaY: 65, clientX: 37.5, clientY: 48.25 });
    expect(wheelZoom).toHaveBeenLastCalledWith("out", 1, { x: 37.5, y: 48.25 });
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(scrollPosition()).toEqual({ x: 0, y: 0 });
  });

  it("zooms for Safari pinch gestures in both directions at the gesture point", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    const start = dispatchGesture(canvas, "gesturestart", 1);
    const spread = dispatchGesture(canvas, "gesturechange", 1.2);
    expect(wheelZoom).toHaveBeenCalledWith("in", 1, { x: 37.5, y: 48.25 });
    dispatchGesture(canvas, "gesturechange", 1);
    expect(wheelZoom).toHaveBeenLastCalledWith("out", 1, { x: 37.5, y: 48.25 });
    const end = dispatchGesture(canvas, "gestureend", 1);
    expect(start.defaultPrevented).toBe(true);
    expect(spread.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true);
    expect(scrollPosition()).toEqual({ x: 0, y: 0 });
  });

  it("zooms once per mouse-wheel notch while ambiguous pixel scrolling pans", () => {
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    dispatchWheel(canvas, { deltaY: -100, clientX: 37.5, clientY: 48.25 }, 120);
    expect(wheelZoom).toHaveBeenCalledWith("in", 1, { x: 37.5, y: 48.25 });
    dispatchWheel(canvas, { deltaY: 200, clientX: 37.5, clientY: 48.25 }, -240);
    expect(wheelZoom).toHaveBeenLastCalledWith("out", 2, { x: 37.5, y: 48.25 });
    expect(scrollPosition()).toEqual({ x: 0, y: 0 });

    wheelZoom.mockClear();
    dispatchWheel(canvas, { deltaY: 20, deltaX: 10 });
    expect(scrollPosition()).toEqual({ x: 10, y: 20 });
    dispatchWheel(canvas, { deltaY: 10, deltaMode: 1, clientX: 37.5, clientY: 48.25 });
    expect(wheelZoom).toHaveBeenCalledWith("out", 3, { x: 37.5, y: 48.25 });
    expect(scrollPosition()).toEqual({ x: 10, y: 20 });
  });

  it("shows a zoom-created offset in the scrollbar and stops ordinary panning farther past it", () => {
    const { container } = render(<GridHarness width={40} height={40} viewportSize={300} initialScroll={{ x: -130, y: -130 }} />);
    const canvas = container.querySelector("canvas")!;
    const [verticalThumb, horizontalThumb] = container.querySelectorAll("div.cursor-pointer");
    expect((verticalThumb as HTMLDivElement).style.transform).toBe("translateY(0px)");
    expect((horizontalThumb as HTMLDivElement).style.transform).toBe("translateX(0px)");

    fireEvent.wheel(canvas, { deltaX: -20, deltaY: -20 });
    expect(scrollPosition()).toEqual({ x: -130, y: -130 });
    fireEvent.wheel(canvas, { deltaX: 20, deltaY: 20 });
    expect(scrollPosition()).toEqual({ x: -110, y: -110 });
  });

  it("maps scrollbar thumbs and dragging to the same pan limits", () => {
    const { container } = render(<GridHarness width={40} height={40} viewportSize={300} />);
    const canvas = container.querySelector("canvas")!;
    const verticalThumb = container.querySelectorAll("div.cursor-pointer")[0] as HTMLDivElement;

    fireEvent.wheel(canvas, { deltaY: -500 });
    expect(scrollPosition().y).toBe(-84);
    expect(verticalThumb.style.transform).toBe("translateY(0px)");

    fireEvent.pointerDown(verticalThumb, { pointerId: 3, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 3, clientY: 20 });
    expect(scrollPosition().y).toBeGreaterThan(-84);
    expect(scrollPosition().y).toBeLessThanOrEqual(184);
    fireEvent.pointerUp(window, { pointerId: 3 });

    fireEvent.wheel(canvas, { deltaY: 1000 });
    expect(scrollPosition().y).toBe(184);
    expect(parseFloat(verticalThumb.style.transform.replace("translateY(", ""))).toBeGreaterThan(0);
  });

  it("keeps the viewport covered when it is smaller than the visible-artwork minimum", () => {
    const { container } = render(<GridHarness width={40} height={40} />);
    const canvas = container.querySelector("canvas")!;
    fireEvent.wheel(canvas, { deltaX: -1000, deltaY: -1000 });
    expect(scrollPosition()).toEqual({ x: 0, y: 0 });
    fireEvent.wheel(canvas, { deltaX: 1000, deltaY: 1000 });
    expect(scrollPosition()).toEqual({ x: 300, y: 300 });
  });

  it("keeps even a tiny fitted canvas visible and gives its scrollbars the full pan range", () => {
    const { container } = render(<GridHarness width={1} height={1} />);
    const canvas = container.querySelector("canvas")!;
    const [verticalThumb, horizontalThumb] = container.querySelectorAll("div.cursor-pointer");
    expect(verticalThumb).toBeDefined();
    expect(horizontalThumb).toBeDefined();

    fireEvent.wheel(canvas, { deltaX: -1000, deltaY: -1000 });
    expect(scrollPosition()).toEqual({ x: -45, y: -45 });
    expect((verticalThumb as HTMLDivElement).style.transform).toBe("translateY(0px)");
    expect((horizontalThumb as HTMLDivElement).style.transform).toBe("translateX(0px)");

    fireEvent.wheel(canvas, { deltaX: 2000, deltaY: 2000 });
    expect(scrollPosition()).toEqual({ x: 45, y: 45 });
    expect(parseFloat((verticalThumb as HTMLDivElement).style.transform.replace("translateY(", ""))).toBeGreaterThan(0);
    expect(parseFloat((horizontalThumb as HTMLDivElement).style.transform.replace("translateX(", ""))).toBeGreaterThan(0);
  });
});
