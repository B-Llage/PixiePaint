import { useEffect, useState } from "react";
import type { Dispatch, MutableRefObject, PointerEvent as ReactPointerEvent, SetStateAction } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PixelPencilSettingsProvider } from "./context/PixelPencilSettingsContext";
import { getPanBounds } from "./canvas-pan";
import packageJson from "../../../package.json";
import { PixelPencil } from "./PixelPencil";
import { MagnifierTool, TOOLS } from "./PixelPencilTools";
import type { PixelValue } from "./PixelPencilTypes";
import type { PreviewMask } from "./grid-geometry";
import type { OverlayFrame } from "./grid-renderer";
import { unpackColor, type PixelBuffer } from "./pixel-buffer";

interface GridHarnessProps {
  displayCellSize: number;
  gridHeight: number;
  toolCursorIcon: string;
  toolCursorHotspot: { x: number; y: number };
  useToolAsMousePointer: boolean;
  composite: PixelBuffer;
  getOverlayFrame: () => OverlayFrame;
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

/** The cell indices a preview mask marks, scanning only its bounds. */
function maskCells(preview: PreviewMask | null, gridWidth: number): number[] {
  if (!preview) return [];
  const cells: number[] = [];
  const { mask, bounds } = preview;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      if (mask[y * gridWidth + x]) cells.push(y * gridWidth + x);
    }
  }
  return cells;
}

const layersPanelRender = vi.hoisted(() => vi.fn());

vi.mock("./LayersPanel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./LayersPanel")>();
  return {
    ...actual,
    LayersPanel: function CountedLayersPanel(props: Parameters<typeof actual.LayersPanel>[0]) {
      layersPanelRender();
      return <actual.LayersPanel {...props} />;
    },
  };
});

vi.mock("./PixelGrid", () => ({
  PixelGrid: function GridHarness(props: GridHarnessProps) {
    const { onViewportResize } = props;
    useEffect(() => {
      onViewportResize({ width: 300, height: 300 });
    }, [onViewportResize]);
    // Overlay masks live in refs read at draw time, so tests sample them on demand.
    const [overlay, setOverlay] = useState<{ brush: number[]; brushSizeShadow: number[] }>({ brush: [], brushSizeShadow: [] });
    const compositeWidth = props.composite.width;
    const compositeValues = Array.from(props.composite.data, (value) => unpackColor(value));

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
        <output data-testid="first-two-pixels">{JSON.stringify(compositeValues.slice(0, 2))}</output>
        <output data-testid="painted-cells">{JSON.stringify(compositeValues.flatMap((value, index) => value === null ? [] : [index]))}</output>
        <output data-testid="brush-preview">{JSON.stringify(overlay.brush)}</output>
        <output data-testid="brush-size-preview">{JSON.stringify(overlay.brushSizeShadow)}</output>
        <button onClick={() => {
          const frame = props.getOverlayFrame();
          setOverlay({
            brush: maskCells(frame.brush, compositeWidth),
            brushSizeShadow: maskCells(frame.brushSizeShadow, compositeWidth),
          });
        }}>Read overlay</button>
        <output data-testid="selection-rect">{JSON.stringify(props.selectionOverlay?.rect ?? null)}</output>
        <output data-testid="canvas-scroll">{JSON.stringify(props.canvasScroll)}</output>
        <output data-testid="canvas-height">{props.gridHeight * props.displayCellSize}</output>
        <output data-testid="cell-size">{props.displayCellSize}</output>
        <output data-testid="grid-width">{props.composite.data.length / props.gridHeight}</output>
        <output data-testid="tool-cursor">{JSON.stringify({ icon: props.toolCursorIcon, hotspot: props.toolCursorHotspot, enabled: props.useToolAsMousePointer })}</output>
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
        <button onClick={() => props.handlePointerMove(pointerAt(4, 0, 4))}>Hover center cell</button>
        {[1, 2, 3].map((cell) => (
          <button key={cell} onClick={() => props.handlePointerMove(pointerAt(cell, 0, cell))}>{`Hover cell ${cell}`}</button>
        ))}
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

function brushPreview(): number[] {
  fireEvent.click(screen.getByRole("button", { name: "Read overlay" }));
  return JSON.parse(screen.getByTestId("brush-preview").textContent ?? "[]") as number[];
}

function brushSizePreview(): number[] {
  fireEvent.click(screen.getByRole("button", { name: "Read overlay" }));
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

describe("PixelPencil picker", () => {
  it("picking a color highlights its palette swatch", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const swatches = () => screen.getAllByRole("button", { name: /^Use color / });
    const swatch = () => screen.getByRole("button", { name: "Use color #1f2937" });

    fireEvent.click(swatch());
    fireEvent.click(screen.getByRole("button", { name: "Paint origin" }));
    await waitFor(() => expect(firstTwoPixels()[0]).toBe("#1f2937"));

    // Switch away so only the picker can bring the swatch back.
    fireEvent.click(screen.getByRole("button", { name: "Use color #000000" }));
    expect(swatch().getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Picker" }));
    fireEvent.click(screen.getByRole("button", { name: "Paint origin" }));
    await waitFor(() => expect(swatch().getAttribute("aria-pressed")).toBe("true"));
    const pressed = swatches().filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toEqual([swatch()]);
    // Picking leaves the artwork unchanged.
    expect(paintedCells()).toEqual([0]);
  });
});

describe("PixelPencil history", () => {
  it("undoes and redoes a bucket fill, a clear, and adding and deleting a layer", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
    const center = 4 * 32 + 4;

    click("Paint origin");
    await waitFor(() => expect(paintedCells()).toEqual([0]));

    // The bucket fills the empty region around the painted origin.
    click("Bucket");
    click("Paint center");
    await waitFor(() => expect(paintedCells()).toHaveLength(32 * 32));
    click("Undo");
    await waitFor(() => expect(paintedCells()).toEqual([0]));
    click("Redo");
    await waitFor(() => expect(paintedCells()).toHaveLength(32 * 32));
    click("Undo");
    await waitFor(() => expect(paintedCells()).toEqual([0]));

    click("Clear");
    click("Yes, clear");
    await waitFor(() => expect(paintedCells()).toEqual([]));
    click("Undo");
    await waitFor(() => expect(paintedCells()).toEqual([0]));

    click("Add Layer");
    click("Pencil");
    click("Paint center");
    await waitFor(() => expect(paintedCells()).toEqual([0, center]));
    const layerTwoRow = () => screen.getByRole("button", { name: "Select Layer 2" }).closest("li") as HTMLElement;
    fireEvent.click(within(layerTwoRow()).getByRole("button", { name: "Delete layer" }));
    await waitFor(() => expect(paintedCells()).toEqual([0]));
    expect(screen.queryByRole("button", { name: "Select Layer 2" })).toBeNull();

    click("Undo");
    await waitFor(() => expect(paintedCells()).toEqual([0, center]));
    click("Undo");
    await waitFor(() => expect(paintedCells()).toEqual([0]));
    expect(screen.getByRole("button", { name: "Select Layer 2" })).not.toBeNull();
    click("Undo");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Select Layer 2" })).toBeNull());

    // Redoing the added layer brings it back blank; redoing the stroke repaints it.
    click("Redo");
    await waitFor(() => expect(screen.getByRole("button", { name: "Select Layer 2" })).not.toBeNull());
    expect(paintedCells()).toEqual([0]);
    click("Redo");
    await waitFor(() => expect(paintedCells()).toEqual([0, center]));
  });
});

describe("PixelPencil grid resize", () => {
  const undoButton = () => screen.getByRole("button", { name: "Undo" }) as HTMLButtonElement;
  const gridWidth = () => Number(screen.getByTestId("grid-width").textContent);

  it("keeps overlapping pixels in place, clears history, and clears the hover cell", async () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Paint center" }));
    await waitFor(() => expect(paintedCells()).toEqual([4 * 32 + 4]));
    fireEvent.click(screen.getByRole("button", { name: "Hover center cell" }));
    expect(brushPreview()).toEqual([4 * 32 + 4]);
    expect(undoButton().disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const [widthOption] = screen.getAllByRole("button", { name: "64px" });
    fireEvent.click(widthOption);

    // The painted cell stays at (4, 4), re-indexed for the wider grid.
    expect(gridWidth()).toBe(64);
    expect(paintedCells()).toEqual([4 * 64 + 4]);
    expect(brushPreview()).toEqual([]);
    expect(undoButton().disabled).toBe(true);

    // Shrinking keeps the top-left region, so (4, 4) survives a 16px width.
    const [narrowOption] = screen.getAllByRole("button", { name: "16px" });
    fireEvent.click(narrowOption);
    expect(gridWidth()).toBe(16);
    expect(paintedCells()).toEqual([4 * 16 + 4]);
    expect(undoButton().disabled).toBe(true);

    // The resized artwork is editable and records history again.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Paint origin" }));
    await waitFor(() => expect(paintedCells()).toEqual([0, 4 * 16 + 4]));
    expect(undoButton().disabled).toBe(false);
  });
});

describe("PixelPencil viewport", () => {
  it("updates the canvas pointer settings when the setting or selected tool changes", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    const cursor = () => JSON.parse(screen.getByTestId("tool-cursor").textContent ?? "{}") as Record<string, unknown>;
    expect(cursor()).toEqual({ icon: "/icons/cursors/Pencil.png", hotspot: { x: 14, y: 28 }, enabled: false });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Use Tool as Mouse Pointer/i }));
    expect(cursor()).toEqual({ icon: "/icons/cursors/Pencil.png", hotspot: { x: 14, y: 28 }, enabled: true });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Eraser" }));
    expect(cursor()).toEqual({ icon: "/icons/cursors/Eraser.png", hotspot: { x: 14, y: 2 }, enabled: true });
  });

  it("shows the common drawing tools first and keeps tool selection working", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    const tools = screen.getByRole("region", { name: "Tools" });
    const settings = screen.getByRole("region", { name: "Tool settings" });
    expect(within(tools).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Pencil", "Eraser", "Bucket", "Picker", "Line", "Shape", "Select", "Move", "Magnifier",
    ]);
    expect(within(settings).getByText("Brush Size")).not.toBeNull();

    fireEvent.click(within(tools).getByRole("button", { name: "Bucket" }));
    expect(within(settings).queryByText("Brush Size")).toBeNull();
    fireEvent.click(within(tools).getByRole("button", { name: "Line" }));
    expect(within(settings).getByText("Brush Size")).not.toBeNull();
  });

  it("keeps the general actions and tools on horizontally scrollable rows", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    const actions = screen.getByRole("region", { name: "General actions" });
    const tools = screen.getByRole("region", { name: "Tools" });
    expect(actions.className).toContain("overflow-x-auto");
    expect(actions.firstElementChild?.className).toContain("flex-nowrap");
    expect(actions.firstElementChild?.className).toContain("[&>button]:shrink-0");
    expect(within(actions).getByRole("button", { name: "Save PNG" })).not.toBeNull();
    expect(tools.className).toContain("overflow-x-auto");
    expect(tools.firstElementChild?.firstElementChild?.className).toContain("flex-nowrap");
    const bucket = within(tools).getByRole("button", { name: "Bucket" });
    expect(bucket.parentElement?.className).toContain("shrink-0");
  });

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

  it("moving the pointer does not re-render the layers panel", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    const rendersAfterMount = layersPanelRender.mock.calls.length;
    expect(rendersAfterMount).toBeGreaterThan(0);

    for (const cell of [1, 2, 3]) {
      fireEvent.click(screen.getByRole("button", { name: `Hover cell ${cell}` }));
    }
    expect(layersPanelRender).toHaveBeenCalledTimes(rendersAfterMount);
    // The hover still reaches the canvas overlay.
    expect(brushPreview()).toEqual([3 * 32 + 3]);
    expect(layersPanelRender).toHaveBeenCalledTimes(rendersAfterMount);
  });

  it("shows the same single-cell hover preview for pencil, line, and shape", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Hover center cell" }));
    expect(brushPreview()).toEqual([4 * 32 + 4]);

    fireEvent.click(screen.getByRole("button", { name: "Line" }));
    expect(brushPreview()).toEqual([4 * 32 + 4]);

    fireEvent.click(screen.getByRole("button", { name: "Shape" }));
    expect(brushPreview()).toEqual([4 * 32 + 4]);
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

  it("lists every tool's real hotkey in the Hotkeys dialog", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Hotkeys" }));

    const dialog = screen.getByRole("dialog", { name: "Hotkeys" });
    for (const tool of TOOLS) {
      const row = within(dialog).getByText(tool.label).closest("li");
      expect(row?.textContent).toContain(tool.hotkey.toUpperCase());
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    fireEvent.keyDown(window, { key: MagnifierTool.hotkey });
    expect(within(screen.getByRole("region", { name: "Tool settings" })).getByText("Zoom Mode")).not.toBeNull();
  });

  it("shows the prepared release version and patch notes in the changelog", () => {
    render(<PixelPencilSettingsProvider><PixelPencil /></PixelPencilSettingsProvider>);

    const versionLabel = `v${packageJson.version}`;
    expect(screen.getByText(versionLabel)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open changelog" }));

    const changelog = screen.getByRole("dialog", { name: "Changelog" });
    expect(within(changelog).getByText(versionLabel)).not.toBeNull();
    expect(within(changelog).getByText(/Move artwork or selections with the new Move tool/)).not.toBeNull();
    expect(within(changelog).getByText(/mobile sheets without changing the canvas size/)).not.toBeNull();
  });
});
