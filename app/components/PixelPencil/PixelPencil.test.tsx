import { useEffect } from "react";
import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixelPencilSettingsProvider } from "./context/PixelPencilSettingsContext";
import { getPanBounds } from "./canvas-pan";
import { PixelPencil } from "./PixelPencil";
import type { PixelValue } from "./PixelPencilTypes";

interface GridHarnessProps {
  displayCellSize: number;
  gridHeight: number;
  pixels: PixelValue[];
  brushSizePreview: Set<number> | null;
  selectionOverlay: { rect: { x: number; y: number; width: number; height: number } } | null;
  gridRef: MutableRefObject<HTMLCanvasElement | null>;
  gridWrapperRef: MutableRefObject<HTMLDivElement | null>;
  canvasScroll: { x: number; y: number };
  onScrollChange: Dispatch<SetStateAction<{ x: number; y: number }>>;
  onViewportResize: (size: { width: number; height: number }) => void;
  onWheelZoom: (direction: "in" | "out", steps: number, point: { x: number; y: number }) => void;
  handlePointerDown: (event: ReactPointerEvent<HTMLCanvasElement>, index: number) => void;
  handlePointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  handlePointerCancel: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
}

vi.mock("./PixelGrid", () => ({
  PixelGrid: function GridHarness(props: GridHarnessProps) {
    const { onViewportResize } = props;
    useEffect(() => {
      onViewportResize({ width: 300, height: 300 });
    }, [onViewportResize]);

    function pointerAt(x: number, offsetX = 0, y = 0): ReactPointerEvent<HTMLCanvasElement> {
      const clientX = (x + 0.5) * props.displayCellSize + offsetX;
      const clientY = (y + 0.5) * props.displayCellSize;
      return pointerAtClient(clientX, clientY);
    }

    function pointerAtClient(clientX: number, clientY: number): ReactPointerEvent<HTMLCanvasElement> {
      const nativeEvent = {
        clientX,
        clientY,
        pointerId: 7,
        getCoalescedEvents: () => [],
      };
      return {
        ...nativeEvent,
        nativeEvent,
        button: 0,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        ctrlKey: false,
        preventDefault: vi.fn(),
        currentTarget: props.gridRef.current,
      } as unknown as ReactPointerEvent<HTMLCanvasElement>;
    }

    return (
      <div ref={(node) => { props.gridWrapperRef.current = node; }}>
        <canvas ref={(node) => { props.gridRef.current = node; }} />
        <output data-testid="first-two-pixels">{JSON.stringify(props.pixels.slice(0, 2))}</output>
        <output data-testid="painted-cells">{JSON.stringify(props.pixels.flatMap((value, index) => value === null ? [] : [index]))}</output>
        <output data-testid="brush-size-preview">{JSON.stringify([...(props.brushSizePreview ?? [])])}</output>
        <output data-testid="selection-rect">{JSON.stringify(props.selectionOverlay?.rect ?? null)}</output>
        <output data-testid="canvas-scroll">{JSON.stringify(props.canvasScroll)}</output>
        <output data-testid="canvas-height">{props.gridHeight * props.displayCellSize}</output>
        <output data-testid="cell-size">{props.displayCellSize}</output>
        <output data-testid="grid-width">{props.pixels.length / props.gridHeight}</output>
        <button onClick={() => props.onWheelZoom("in", 1, { x: 73.25, y: 91.5 })}>Zoom wheel in</button>
        <button onClick={() => props.onWheelZoom("out", 1, { x: 73.25, y: 91.5 })}>Zoom wheel out</button>
        <button onClick={() => props.onWheelZoom("in", 4, { x: 73.25, y: 91.5 })}>Zoom wheel four steps</button>
        <button onClick={() => props.onWheelZoom("out", 4, { x: 73.25, y: 91.5 })}>Zoom wheel out four steps</button>
        <button onClick={() => props.onWheelZoom("out", 1, { x: 215, y: 150 })}>Zoom wheel out at edge</button>
        <button onClick={() => props.handlePointerDown(pointerAtClient(73.25, 91.5), 0)}>Magnifier click at cursor</button>
        <button onClick={() => props.handlePointerDown({ ...pointerAtClient(73.25, 91.5), shiftKey: true } as ReactPointerEvent<HTMLCanvasElement>, 0)}>Magnifier shift click at cursor</button>
        <button onClick={() => props.onScrollChange({ x: -20, y: 0 })}>Pan view left</button>
        <button onClick={() => props.onScrollChange({ x: -1000, y: 1000 })}>Pan view to limits</button>
        <button onClick={() => props.onViewportResize({ width: 200, height: 200 })}>Resize viewport</button>
        <button onClick={() => {
          props.handlePointerDown(pointerAt(0, 20), 0);
          props.handlePointerUp(pointerAt(0, 20));
        }}>Paint at shifted origin</button>
        <button onClick={() => {
          props.handlePointerDown(pointerAt(0), 0);
          props.handlePointerUp(pointerAt(0));
        }}>Paint origin</button>
        <button onClick={() => {
          props.handlePointerDown(pointerAt(4, 0, 4), 4 * 32 + 4);
          props.handlePointerUp(pointerAt(4, 0, 4));
        }}>Paint center</button>
        <button onClick={() => props.handlePointerDown(pointerAt(4, 0, 4), 4 * 32 + 4)}>Start center stroke</button>
        <button onClick={() => props.handlePointerUp(pointerAt(6, 0, 4))}>Finish center stroke</button>
        <button onClick={() => props.handlePointerDown(pointerAt(0), 0)}>Start move</button>
        <button onClick={() => props.handlePointerMove(pointerAt(1))}>Drag one cell</button>
        <button onClick={() => props.handlePointerUp(pointerAt(1))}>Finish move</button>
        <button onClick={() => props.handlePointerCancel(pointerAt(1))}>Cancel move</button>
      </div>
    );
  },
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => vi.unstubAllGlobals());

function firstTwoPixels(): PixelValue[] {
  return JSON.parse(screen.getByTestId("first-two-pixels").textContent ?? "[]") as PixelValue[];
}

function paintedCells(): number[] {
  return JSON.parse(screen.getByTestId("painted-cells").textContent ?? "[]") as number[];
}

function brushSizePreview(): number[] {
  return JSON.parse(screen.getByTestId("brush-size-preview").textContent ?? "[]") as number[];
}

function scrollPosition(): { x: number; y: number } {
  return JSON.parse(screen.getByTestId("canvas-scroll").textContent ?? "{}") as { x: number; y: number };
}

function artworkPointAt(clientX: number, clientY: number): { x: number; y: number } {
  const cellSize = Number(screen.getByTestId("cell-size").textContent);
  const gridWidth = Number(screen.getByTestId("grid-width").textContent);
  const gridHeight = Number(screen.getByTestId("canvas-height").textContent) / cellSize;
  const offsetX = gridWidth * cellSize <= 300 ? (300 - gridWidth * cellSize) / 2 : 0;
  const offsetY = gridHeight * cellSize <= 300 ? (300 - gridHeight * cellSize) / 2 : 0;
  const scroll = scrollPosition();
  return {
    x: (scroll.x + clientX - offsetX) / cellSize,
    y: (scroll.y + clientY - offsetY) / cellSize,
  };
}

describe("PixelPencil move tool", () => {
  it("cancels a drag without history, then supports undo and redo for a committed move", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Paint origin" }));
    await waitFor(() => expect(firstTwoPixels()[0]).not.toBeNull());
    const color = firstTwoPixels()[0];
    expect(firstTwoPixels()).toEqual([color, null]);

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    fireEvent.click(screen.getByRole("button", { name: "Start move" }));
    fireEvent.click(screen.getByRole("button", { name: "Drag one cell" }));
    await waitFor(() => expect(firstTwoPixels()).toEqual([null, color]));
    fireEvent.click(screen.getByRole("button", { name: "Cancel move" }));
    await waitFor(() => expect(firstTwoPixels()).toEqual([color, null]));

    fireEvent.click(screen.getByRole("button", { name: "Start move" }));
    fireEvent.click(screen.getByRole("button", { name: "Drag one cell" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish move" }));
    await waitFor(() => expect(firstTwoPixels()).toEqual([null, color]));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(firstTwoPixels()).toEqual([color, null]));
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    await waitFor(() => expect(firstTwoPixels()).toEqual([null, color]));
  });
});

describe("PixelPencil viewport", () => {
  it("opens mobile controls over the canvas without changing its viewport or scale", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    const { container } = render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const panelNavigation = screen.getByRole("navigation", { name: "Canvas panels" });
    const layersButton = within(panelNavigation).getByRole("button", { name: "Layers" });
    const paletteButton = within(panelNavigation).getByRole("button", { name: "Palette" });
    const canvas = container.querySelector("canvas");
    const canvasArea = container.querySelector("main")?.firstElementChild;
    const initialCellSize = screen.getByTestId("cell-size").textContent;
    const initialCanvasHeight = screen.getByTestId("canvas-height").textContent;

    fireEvent.click(layersButton);
    const layersPanel = screen.getByRole("region", { name: "Layers" });
    expect(layersButton.getAttribute("aria-expanded")).toBe("true");
    expect(paletteButton.getAttribute("aria-expanded")).toBe("false");
    expect(layersPanel.parentElement).toBe(canvasArea);
    expect(layersPanel.className).toContain("absolute");
    expect(layersPanel.className).toContain("max-h-[60%]");
    expect(canvasArea?.className).toContain("flex-1");
    expect(within(layersPanel).getByRole("button", { name: "Add Layer" })).not.toBeNull();

    fireEvent.click(paletteButton);
    const palettePanel = screen.getByRole("region", { name: "Palette" });
    expect(screen.queryByRole("region", { name: "Layers" })).toBeNull();
    expect(within(palettePanel).getByText("Palette Set")).not.toBeNull();
    expect(paletteButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(screen.getByTestId("cell-size").textContent).toBe(initialCellSize);
    expect(screen.getByTestId("canvas-height").textContent).toBe(initialCanvasHeight);

    fireEvent.click(within(palettePanel).getByRole("button", { name: "Close palette" }));
    expect(screen.queryByRole("region", { name: "Palette" })).toBeNull();
    expect(paletteButton.getAttribute("aria-expanded")).toBe("false");
    expect(paletteButton).toBe(document.activeElement);
    expect(screen.getByTestId("cell-size").textContent).toBe(initialCellSize);
    expect(screen.getByTestId("canvas-height").textContent).toBe(initialCanvasHeight);

    fireEvent.click(layersButton);
    fireEvent.click(layersButton);
    expect(screen.queryByRole("region", { name: "Layers" })).toBeNull();
    expect(layersButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("cell-size").textContent).toBe(initialCellSize);
  });

  it("keeps mobile controls available while drawing and closes them with Escape", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const panelNavigation = screen.getByRole("navigation", { name: "Canvas panels" });
    const paletteButton = within(panelNavigation).getByRole("button", { name: "Palette" });
    fireEvent.click(paletteButton);
    const palettePanel = screen.getByRole("region", { name: "Palette" });
    const colorButton = within(palettePanel).getAllByRole("button", { name: /^Use color / })[0];
    const color = colorButton.getAttribute("aria-label")?.replace("Use color ", "");
    fireEvent.click(colorButton);
    fireEvent.click(screen.getByRole("button", { name: "Paint origin" }));
    await waitFor(() => expect(firstTwoPixels()[0]).toBe(color));
    expect(screen.getByRole("region", { name: "Palette" })).not.toBeNull();

    fireEvent.click(within(panelNavigation).getByRole("button", { name: "Layers" }));
    const layersPanel = screen.getByRole("region", { name: "Layers" });
    fireEvent.click(within(layersPanel).getByRole("button", { name: "Add Layer" }));
    expect(screen.getByRole("region", { name: "Layers" })).not.toBeNull();
    expect(within(layersPanel).getByRole("button", { name: "Select Layer 2" })).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Layers" })).toBeNull();
    expect(within(panelNavigation).getByRole("button", { name: "Layers" })).toBe(document.activeElement);
  });

  it("keeps the precise artwork point under an off-center cursor for wheel zoom in and out", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const point = artworkPointAt(73.25, 91.5);

    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel in" }));
    expect(artworkPointAt(73.25, 91.5).x).toBeCloseTo(point.x);
    expect(artworkPointAt(73.25, 91.5).y).toBeCloseTo(point.y);
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel out" }));
    expect(artworkPointAt(73.25, 91.5).x).toBeCloseTo(point.x);
    expect(artworkPointAt(73.25, 91.5).y).toBeCloseTo(point.y);
  });

  it("anchors magnifier clicks, including shift click to zoom out", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Magnifier" }));
    const point = artworkPointAt(73.25, 91.5);

    fireEvent.click(screen.getByRole("button", { name: "Magnifier click at cursor" }));
    expect(artworkPointAt(73.25, 91.5).x).toBeCloseTo(point.x);
    expect(artworkPointAt(73.25, 91.5).y).toBeCloseTo(point.y);
    fireEvent.click(screen.getByRole("button", { name: "Magnifier shift click at cursor" }));
    expect(artworkPointAt(73.25, 91.5).x).toBeCloseTo(point.x);
    expect(artworkPointAt(73.25, 91.5).y).toBeCloseTo(point.y);
  });

  it("preserves the cursor anchor through multiple steps and leaves pan unchanged at zoom limits", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const point = artworkPointAt(73.25, 91.5);
    const initialCellSize = Number(screen.getByTestId("cell-size").textContent);
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel four steps" }));
    expect(Number(screen.getByTestId("cell-size").textContent)).toBe(initialCellSize * 5);
    expect(artworkPointAt(73.25, 91.5).x).toBeCloseTo(point.x);
    expect(artworkPointAt(73.25, 91.5).y).toBeCloseTo(point.y);
    const maxScroll = scrollPosition();
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel in" }));
    expect(scrollPosition()).toEqual(maxScroll);
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel out four steps" }));
    expect(artworkPointAt(73.25, 91.5).x).toBeCloseTo(point.x);
    expect(artworkPointAt(73.25, 91.5).y).toBeCloseTo(point.y);
    const minScroll = scrollPosition();
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel out" }));
    expect(scrollPosition()).toEqual(minScroll);
  });

  it("allows zoom out near an artwork edge to retain the cursor anchor beyond normal pan limits", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel in" }));
    fireEvent.click(screen.getByRole("button", { name: "Pan view to limits" }));
    const point = artworkPointAt(215, 150);
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel out at edge" }));
    expect(artworkPointAt(215, 150).x).toBeCloseTo(point.x);
    expect(artworkPointAt(215, 150).y).toBeCloseTo(point.y);
    const extended = scrollPosition();
    const cellSize = Number(screen.getByTestId("cell-size").textContent);
    const artworkWidth = Number(screen.getByTestId("grid-width").textContent) * cellSize;
    const offset = artworkWidth <= 300 ? (300 - artworkWidth) / 2 : 0;
    const normalMin = getPanBounds(artworkWidth, 300, offset).min;
    expect(extended.x).toBeLessThan(normalMin);
    fireEvent.click(screen.getByRole("button", { name: "Pan view to limits" }));
    expect(scrollPosition().x).toBe(extended.x);
    fireEvent.click(screen.getByRole("button", { name: "Pan view left" }));
    fireEvent.click(screen.getByRole("button", { name: "Pan view to limits" }));
    expect(scrollPosition().x).toBe(normalMin);
  });

  it("clears a zoom-created pan exception when the viewport changes", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel in" }));
    fireEvent.click(screen.getByRole("button", { name: "Pan view to limits" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom wheel out at edge" }));
    fireEvent.click(screen.getByRole("button", { name: "Resize viewport" }));

    const cellSize = Number(screen.getByTestId("cell-size").textContent);
    const artworkWidth = Number(screen.getByTestId("grid-width").textContent) * cellSize;
    const offset = artworkWidth <= 200 ? (200 - artworkWidth) / 2 : 0;
    const bounds = getPanBounds(artworkWidth, 200, offset);
    expect(scrollPosition().x).toBeGreaterThanOrEqual(bounds.min);
    expect(scrollPosition().x).toBeLessThanOrEqual(bounds.max);
  });
  it("lets the canvas fill the editor area without layout padding", () => {
    const { container } = render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const canvasArea = container.querySelector("main")?.firstElementChild;

    expect(canvasArea).not.toBeNull();
    expect(canvasArea?.className).toContain("flex-1");
    expect(canvasArea?.className).toContain("min-h-0");
    expect(canvasArea?.className).not.toMatch(/(?:^|\s)(?:(?:sm|md|lg|xl|2xl):)?(?:p|px|py|pt|pr|pb|pl)-\S+/);
  });

  it("clamps requested offsets so the artwork remains visible", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Pan view to limits" }));
    const scroll = JSON.parse(screen.getByTestId("canvas-scroll").textContent ?? "{}") as { x: number; y: number };
    const canvasHeight = Number(screen.getByTestId("canvas-height").textContent);
    expect(scroll).toEqual({ x: -84, y: canvasHeight - 216 });
  });

  it("keeps signed pan offsets and maps drawing through the shifted canvas", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Pan view left" }));
    expect(screen.getByTestId("canvas-scroll").textContent).toBe('{"x":-20,"y":0}');
    fireEvent.click(screen.getByRole("button", { name: "Paint at shifted origin" }));
    await waitFor(() => expect(firstTwoPixels()[0]).not.toBeNull());
    expect(firstTwoPixels()[1]).toBeNull();
  });
});

describe("PixelPencil controls", () => {
  it("shows a centered ghost of the current brush only during size dragging", () => {
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    });
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const size = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    expect(brushSizePreview()).toHaveLength(0);

    size.focus();
    fireEvent.pointerDown(size, { pointerId: 31, button: 0, clientY: 100 });
    expect(brushSizePreview()).toHaveLength(0);
    fireEvent.pointerMove(window, { pointerId: 31, clientY: 92 });
    expect(size.value).toBe("2");
    expect(brushSizePreview()).toHaveLength(4);
    expect(brushSizePreview()).toContain(9 * 32 + 9);
    fireEvent.pointerMove(window, { pointerId: 31, clientY: 76 });
    expect(size.value).toBe("4");
    expect(brushSizePreview()).toHaveLength(16);
    expect(paintedCells()).toHaveLength(0);

    fireEvent.pointerUp(window, { pointerId: 31, clientY: 76 });
    expect(brushSizePreview()).toHaveLength(0);
    expect(document.activeElement).not.toBe(size);

    fireEvent.click(screen.getByRole("button", { name: "Circle" }));
    fireEvent.pointerDown(size, { pointerId: 32, button: 0, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 32, clientY: 92 });
    expect(size.value).toBe("5");
    expect(brushSizePreview()).toHaveLength(21);
    fireEvent.pointerCancel(window, { pointerId: 32 });
    expect(brushSizePreview()).toHaveLength(0);
  });

  it("uses the first canvas click after typing to leave the brush size field", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const size = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    size.focus();
    fireEvent.change(size, { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    expect(document.activeElement).not.toBe(size);
    expect(paintedCells()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(16));
  });

  it("leaves the brush size field after dragging so canvas shortcuts work", () => {
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    });
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const size = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    size.focus();
    fireEvent.pointerDown(size, { pointerId: 21, button: 0, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 21, clientY: 84 });
    expect(document.activeElement).not.toBe(size);
    fireEvent.pointerUp(window, { pointerId: 21, clientY: 84 });

    expect(size.value).toBe("3");
    expect(document.activeElement).not.toBe(size);
    fireEvent.keyDown(document.activeElement ?? window, { key: "a", metaKey: true });
    expect(screen.getByTestId("selection-rect").textContent).toBe('{"x":0,"y":0,"width":32,"height":32}');
  });

  it("changes the active brush footprint while dragging the size field up or down", async () => {
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    });
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const size = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    expect(window.getComputedStyle(size).colorScheme).toBe("dark");
    fireEvent.change(size, { target: { value: "4" } });

    fireEvent.pointerDown(size, { pointerId: 11, button: 0, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 11, clientY: 84 });
    expect(size.value).toBe("6");
    fireEvent.pointerUp(window, { pointerId: 11, clientY: 84 });
    fireEvent.pointerMove(window, { pointerId: 11, clientY: 60 });
    expect(size.value).toBe("6");

    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(36));

    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    const eraserSize = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    fireEvent.pointerDown(eraserSize, { pointerId: 12, button: 0, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 12, clientY: 124 });
    fireEvent.pointerUp(window, { pointerId: 12, clientY: 124 });
    expect(eraserSize.value).toBe("3");

    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(27));

    fireEvent.pointerDown(eraserSize, { pointerId: 13, button: 0, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 13, clientY: -4000 });
    expect(eraserSize.value).toBe("256");
    fireEvent.pointerMove(window, { pointerId: 13, clientY: 4000 });
    expect(eraserSize.value).toBe("1");
    fireEvent.pointerUp(window, { pointerId: 13, clientY: 4000 });
  });

  it("keeps the last valid size when a typed value is empty or outside the supported range", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const size = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    fireEvent.change(size, { target: { value: "4" } });

    for (const invalid of ["", "0", "1.5", "257"]) {
      fireEvent.change(size, { target: { value: invalid } });
      fireEvent.blur(size);
      expect(size.value).toBe("4");
    }

    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(16));
  });

  it("applies typed brush sizes to pencil and eraser strokes", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const size = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;

    fireEvent.change(size, { target: { value: "4" } });
    expect(size.value).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(16));
    expect(paintedCells()).toContain(6 * 32 + 6);

    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    const eraserSize = screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement;
    expect(eraserSize.value).toBe("4");
    fireEvent.change(eraserSize, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(12));
    expect(paintedCells()).not.toContain(4 * 32 + 4);
  });

  it("uses typed sizes for line and shape tools", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Brush Size" }), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Start center stroke" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish center stroke" }));
    await waitFor(() => expect(paintedCells()).toContain(6 * 32 + 8));

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(0));
    fireEvent.click(screen.getByRole("button", { name: "Shape" }));
    expect((screen.getByRole("spinbutton", { name: "Brush Size" }) as HTMLInputElement).value).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Start center stroke" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish center stroke" }));
    await waitFor(() => expect(paintedCells()).toContain(6 * 32 + 8));
  });

  it("expands circular brushes beyond three pixels", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Brush Size" }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Circle" }));
    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toHaveLength(21));
    expect(paintedCells()).toContain(4 * 32 + 6);
    expect(paintedCells()).not.toContain(2 * 32 + 2);
  });

  it("places left-aligned general actions above the canvas and tools with their options below it", () => {
    const { container } = render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const leftSidebar = container.querySelector("aside");
    const generalActions = screen.getByRole("region", { name: "General actions" });
    const tools = screen.getByRole("region", { name: "Tools" });
    const toolSettings = screen.getByRole("region", { name: "Tool settings" });
    const pencilButton = screen.getByRole("button", { name: "Pencil" });
    const canvas = container.querySelector("canvas");

    expect(leftSidebar).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(generalActions.firstElementChild?.classList.contains("justify-start")).toBe(true);
    expect(within(generalActions).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Undo", "Redo", "Clear", "Settings", "Hotkeys", "Save PNG",
    ]);
    expect(generalActions.compareDocumentPosition(canvas as HTMLCanvasElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((canvas as HTMLCanvasElement).compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tools.compareDocumentPosition(toolSettings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(leftSidebar as HTMLElement).getByText("Palette Set")).not.toBeNull();
    expect(within(leftSidebar?.children[1] as HTMLElement).getByLabelText("Hue")).not.toBeNull();
    expect(within(leftSidebar?.children[1] as HTMLElement).getByLabelText("Saturation")).not.toBeNull();
    expect(within(leftSidebar?.children[1] as HTMLElement).getByLabelText("Lightness")).not.toBeNull();
    expect(within(tools).getByRole("button", { name: "Pencil" })).toBe(pencilButton);
    expect(within(toolSettings).getByText("Brush Size")).not.toBeNull();
    expect(within(toolSettings).queryByText("Palette Set")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(within(toolSettings).getByText("Auto Pick Layer")).not.toBeNull();
    expect(within(leftSidebar as HTMLElement).getByText("Palette Set")).not.toBeNull();
    expect(within(leftSidebar as HTMLElement).getByLabelText("Lightness")).not.toBeNull();

    const autoPickLayer = within(toolSettings).getByRole("checkbox", { name: /Auto Pick Layer/i }) as HTMLInputElement;
    fireEvent.click(autoPickLayer);
    expect(autoPickLayer.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Shape" }));
    expect(within(toolSettings).getByRole("button", { name: "Triangle" })).not.toBeNull();
    expect(within(toolSettings).getByRole("checkbox", { name: /Filled Shape/i })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Magnifier" }));
    expect(within(toolSettings).getByRole("button", { name: "Zoom Out" })).not.toBeNull();
    expect(screen.getByRole("region", { name: "Tool settings" })).toBe(toolSettings);
  });

  it("shows the prepared release version and patch notes in the changelog", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    expect(screen.getByText("v0.3.0")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open changelog" }));

    const changelog = screen.getByRole("dialog", { name: "Changelog" });
    expect(within(changelog).getByText("v0.3.0")).not.toBeNull();
    expect(within(changelog).getByText(/Move artwork or selections with the new Move tool/)).not.toBeNull();
    expect(within(changelog).getByText(/mobile sheets without changing the canvas size/)).not.toBeNull();
  });
});
