import { useEffect, useRef, useState } from "react";
import type { MutableRefObject, RefObject, SetStateAction } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixelGrid } from "./PixelGrid";
import { BucketTool, ColorPickerTool, EraserTool, LineTool, MagnifierTool, MoveTool, PencilTool, RectSelectionTool, ShapeTool } from "./PixelPencilTools";
import type { PaintTool, SelectionState } from "./PixelPencilTypes";
import { clampPan, getPanBounds, includePanOffset } from "./canvas-pan";
import { createMask, stampCells } from "./grid-geometry";
import type { OverlayFrame } from "./grid-renderer";
import { useRedrawSignal } from "./hooks/useRedrawSignal";
import { createBuffer, packColor, TRANSPARENT_PIXEL, type DirtyRect, type PixelBuffer } from "./pixel-buffer";

const pointerDown = vi.fn();
const pointerMove = vi.fn();
const pointerUp = vi.fn();
const pointerCancel = vi.fn();
const backgroundDown = vi.fn();
const wheelZoom = vi.fn();
const viewportResize = vi.fn();

const EMPTY_FRAME: OverlayFrame = {
  path: null,
  brush: null,
  bucket: null,
  brushSizeShadow: null,
  pathColor: "#000000",
  hoverColor: "#000000",
  dim: false,
};
const emptyOverlay = () => EMPTY_FRAME;
const noRedraw = { subscribe: () => () => {} };

type HarnessProps = {
  width?: number;
  height?: number;
  viewportSize?: number;
  initialScroll?: { x: number; y: number };
  tool?: string;
  cursorTool?: PaintTool;
  useToolAsMousePointer?: boolean;
  composite?: PixelBuffer;
  compositeVersion?: number;
  compositeDirtyRef?: RefObject<DirtyRect | null>;
  getOverlayFrame?: () => OverlayFrame;
  redraw?: { subscribe(listener: () => void): () => void };
  selectionOverlay?: SelectionState | null;
};

function GridHarness({
  width = 4,
  height = 4,
  viewportSize = 100,
  initialScroll = { x: 0, y: 0 },
  tool = "pencil",
  cursorTool = PencilTool,
  useToolAsMousePointer = false,
  composite,
  compositeVersion = 0,
  compositeDirtyRef,
  getOverlayFrame = emptyOverlay,
  redraw = noRedraw,
  selectionOverlay = null,
}: HarnessProps) {
  const [scroll, setScroll] = useState(initialScroll);
  const [ownComposite] = useState(() => createBuffer(width, height));
  const ownDirtyRef = useRef<DirtyRect | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
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
        composite={composite ?? ownComposite}
        compositeVersion={compositeVersion}
        compositeDirtyRef={compositeDirtyRef ?? ownDirtyRef}
        getOverlayFrame={getOverlayFrame}
        redraw={redraw}
        showPixelGrid={false}
        checkerSize={1}
        tool={tool}
        toolCursorIcon={cursorTool.cursorIcon}
        toolCursorHotspot={cursorTool.cursorHotspot}
        useToolAsMousePointer={useToolAsMousePointer}
        wrapperMaxWidth={viewportSize}
        wrapperMaxHeight={viewportSize}
        canvasScroll={scroll}
        onScrollChange={changeScroll}
        onViewportResize={viewportResize}
        onWheelZoom={wheelZoom}
        selectionOverlay={selectionOverlay}
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

/** jsdom has no ImageData without the canvas package. */
class ImageDataStub {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(dataOrWidth: Uint8ClampedArray | number, width: number, height?: number) {
    if (typeof dataOrWidth === "number") {
      this.width = dataOrWidth;
      this.height = width;
      this.data = new Uint8ClampedArray(dataOrWidth * width * 4);
    } else {
      this.data = dataOrWidth;
      this.width = width;
      this.height = height ?? dataOrWidth.length / 4 / width;
    }
  }
}

type Call = { name: string; args: unknown[] };

function createContextStub() {
  const calls: Call[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  return {
    calls,
    fillStyle: "" as unknown,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    setTransform: record("setTransform"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    rect: record("rect"),
    clip: record("clip"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    putImageData: record("putImageData"),
    drawImage: record("drawImage"),
    createPattern: () => null,
  };
}

type ContextStub = ReturnType<typeof createContextStub>;

/** Gives every canvas (on-screen and offscreen) its own recording context. */
function stubCanvasContexts() {
  const contexts = new Map<HTMLCanvasElement, ContextStub>();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function getContext(this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      context = createContextStub();
      contexts.set(this, context);
    }
    return context as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  return {
    of: (canvas: HTMLCanvasElement) => contexts.get(canvas)!,
    all: () => [...contexts.values()],
  };
}

/** The destination rects (x, y, width, height) of every `drawImage` on a context. */
const drawDestinations = (context: ContextStub) =>
  context.calls.filter((call) => call.name === "drawImage").map((call) => (call.args as number[]).slice(5));

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
  vi.stubGlobal("ImageData", ImageDataStub);
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
  it("uses the selected tool icon only on the canvas while enabled", () => {
    const { container, rerender } = render(<GridHarness />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    const wrapper = canvas.parentElement as HTMLDivElement;

    expect(canvas.style.cursor).toBe("");
    expect(wrapper.style.cursor).toBe("");

    rerender(<GridHarness useToolAsMousePointer />);
    expect(canvas.style.cursor).toBe('url("/icons/cursors/Pencil.png") 14 28, auto');
    expect(wrapper.style.cursor).toBe("");

    rerender(<GridHarness cursorTool={EraserTool} useToolAsMousePointer />);
    expect(canvas.style.cursor).toBe('url("/icons/cursors/Eraser.png") 14 2, auto');

    rerender(<GridHarness cursorTool={EraserTool} />);
    expect(canvas.style.cursor).toBe("");
  });

  it.each([
    [BucketTool, 2, 28],
    [ColorPickerTool, 2, 26],
    [LineTool, 2, 28],
    [RectSelectionTool, 0, 0],
    [ShapeTool, 0, 0],
    [MoveTool, 0, 0],
    [MagnifierTool, 0, 0],
  ])("places the %s pointer click point at its working end", (cursorTool, x, y) => {
    const { container } = render(<GridHarness cursorTool={cursorTool} useToolAsMousePointer />);
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;
    expect(canvas.style.cursor).toBe(`url("${cursorTool.cursorIcon}") ${x} ${y}, auto`);
  });

  it("renders fitted artwork at its centered base position and keeps a strip visible at the pan limit", () => {
    const contexts = stubCanvasContexts();
    const { container } = render(<GridHarness />);
    const canvas = container.querySelector("canvas")!;
    const context = contexts.of(canvas);
    // The composite is one scaled blit of the visible cells.
    expect(drawDestinations(context)).toEqual([[30, 30, 40, 40]]);

    context.calls.length = 0;
    fireEvent.wheel(canvas, { deltaX: -20, deltaY: -20 });
    expect(drawDestinations(context)).toEqual([[50, 50, 40, 40]]);

    context.calls.length = 0;
    fireEvent.wheel(canvas, { deltaX: 120, deltaY: 120 });
    expect(scrollPosition()).toEqual({ x: 30, y: 30 });
    expect(context.calls).toContainEqual({ name: "fillRect", args: [0, 0, 100, 100] });
    expect(drawDestinations(context)).toEqual([[0, 0, 40, 40]]);
  });

  it("uploads the dirty rect after a composite change, and everything for a new buffer", () => {
    const contexts = stubCanvasContexts();
    const composite = createBuffer(4, 4);
    const dirtyRef: { current: DirtyRect | null } = { current: null };
    const uploads = () =>
      contexts
        .all()
        .flatMap((context) => context.calls)
        .filter((call) => call.name === "putImageData")
        .map((call) => call.args.slice(3));
    const { rerender } = render(<GridHarness composite={composite} compositeDirtyRef={dirtyRef} />);
    expect(uploads()).toEqual([[0, 0, 4, 4]]);

    composite.data[5] = packColor("#ff0000");
    dirtyRef.current = { x: 1, y: 1, width: 1, height: 1 };
    rerender(<GridHarness composite={composite} compositeDirtyRef={dirtyRef} compositeVersion={1} />);
    expect(uploads().at(-1)).toEqual([1, 1, 1, 1]);
    expect(dirtyRef.current).toBeNull();

    // A version change without a dirty rect re-uploads the whole buffer.
    rerender(<GridHarness composite={composite} compositeDirtyRef={dirtyRef} compositeVersion={2} />);
    expect(uploads().at(-1)).toEqual([0, 0, 4, 4]);

    // A new buffer (a resize) gets a new surface, uploaded in full.
    const resized = createBuffer(4, 4);
    rerender(<GridHarness composite={resized} compositeDirtyRef={dirtyRef} compositeVersion={2} />);
    expect(uploads()).toHaveLength(4);
    expect(uploads().at(-1)).toEqual([0, 0, 4, 4]);
  });

  it("skips the composite blit while the buffer and grid sizes disagree", () => {
    const contexts = stubCanvasContexts();
    const { container } = render(<GridHarness composite={createBuffer(2, 2)} />);
    expect(drawDestinations(contexts.of(container.querySelector("canvas")!))).toEqual([]);
  });

  it("a redraw request draws the overlay once per frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const contexts = stubCanvasContexts();
    const grid = { width: 4, height: 4 };
    const brushMask = createMask(grid);
    const overlay = vi.fn((): OverlayFrame => ({
      ...EMPTY_FRAME,
      brush: { mask: brushMask, bounds: stampCells(brushMask, grid, [5], null)! },
    }));
    let requestRedraw: () => void = () => {};
    function SignalHarness() {
      const redraw = useRedrawSignal();
      useEffect(() => {
        requestRedraw = redraw.requestRedraw;
      }, [redraw.requestRedraw]);
      return <GridHarness redraw={redraw} getOverlayFrame={overlay} />;
    }
    const { container } = render(<SignalHarness />);
    const context = contexts.of(container.querySelector("canvas")!);
    const callsBefore = overlay.mock.calls.length;
    context.calls.length = 0;

    act(() => {
      requestRedraw();
      requestRedraw();
      requestRedraw();
    });
    expect(frames).toHaveLength(1);
    expect(overlay).toHaveBeenCalledTimes(callsBefore);

    act(() => {
      for (const frame of frames.splice(0)) frame(0);
    });
    expect(overlay).toHaveBeenCalledTimes(callsBefore + 1);
    // One composite blit and one overlay blit over the hovered cell.
    expect(drawDestinations(context)).toEqual([[30, 30, 40, 40], [40, 40, 10, 10]]);
  });

  it("the floating selection draws no per-pixel DOM nodes", () => {
    const contexts = stubCanvasContexts();
    const selection: SelectionState = {
      rect: { x: 0, y: 0, width: 2, height: 2 },
      offset: { dx: 1, dy: 0 },
      data: new Uint32Array([packColor("#ff0000"), TRANSPARENT_PIXEL, packColor("#00ff00"), 0]),
      isFloating: true,
    };
    const { container } = render(<GridHarness selectionOverlay={selection} />);
    expect(container.querySelectorAll(".selection-floating-pixel")).toHaveLength(0);
    expect(container.querySelectorAll(".selection-border")).toHaveLength(1);
    // The pixels are blitted on the canvas at the offset rect, after the composite.
    expect(drawDestinations(contexts.of(container.querySelector("canvas")!))).toEqual([
      [30, 30, 40, 40],
      [40, 30, 20, 20],
    ]);
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
