import { act, fireEvent, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ToolId } from "../PixelPencilTools";
import type { Layer, PixelValue, SelectionRect, SelectionState } from "../PixelPencilTypes";
import { useMoveDrag } from "./useMoveDrag";

const GRID = 4;
const CELL = 10;
const TOTAL = GRID * GRID;

const client = (cellX: number, cellY: number) => ({
  clientX: cellX * CELL + CELL / 2,
  clientY: cellY * CELL + CELL / 2,
});

const makeLayer = (id: string, filledIndices: Record<number, PixelValue> = {}): Layer => {
  const pixels = new Array<PixelValue>(TOTAL).fill(null);
  for (const [index, color] of Object.entries(filledIndices)) {
    pixels[Number(index)] = color;
  }
  return { id, name: id, pixels, visible: true };
};

function makeCanvas() {
  let captured: number | null = null;
  return {
    setPointerCapture: vi.fn((id: number) => {
      captured = id;
    }),
    hasPointerCapture: vi.fn((id: number) => captured === id),
    releasePointerCapture: vi.fn((id: number) => {
      if (captured === id) captured = null;
    }),
    isCaptured: () => captured,
  };
}

type Props = { tool: ToolId; autoPickLayer: boolean };

function setup(options: {
  layers?: Layer[];
  activeLayerId?: string;
  selection?: SelectionState | null;
  tool?: ToolId;
  autoPickLayer?: boolean;
} = {}) {
  const canvas = makeCanvas();
  const gridRef = { current: canvas as unknown as HTMLCanvasElement };
  const layersRef = { current: options.layers ?? [makeLayer("a", { 5: "#b" })] };
  const selectionRef = { current: options.selection ?? null };
  const activePixelsRef = { current: [] as PixelValue[] };
  const history = {
    saveStacks: vi.fn(() => ({ undo: [], redo: [] })),
    restoreStacks: vi.fn(),
    beginActionWithSnapshot: vi.fn(),
    finalizeAction: vi.fn(),
  };
  const resolvePointerFromClientPoint = (clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const cellX = Math.max(0, Math.min(GRID - 1, Math.floor(clientX / CELL)));
    const cellY = Math.max(0, Math.min(GRID - 1, Math.floor(clientY / CELL)));
    return { index: cellY * GRID + cellX, cellX, cellY };
  };
  const captureSelectionPixels = (rect: SelectionRect, source: PixelValue[] = activePixelsRef.current) => {
    const result = [];
    for (let relY = 0; relY < rect.height; relY += 1) {
      for (let relX = 0; relX < rect.width; relX += 1) {
        const color = source[(rect.y + relY) * GRID + rect.x + relX];
        if (color !== null) result.push({ relX, relY, color });
      }
    }
    return result;
  };

  const hook = renderHook(
    ({ tool, autoPickLayer }: Props) => {
      const [activeLayerId, setActiveLayerId] = useState(options.activeLayerId ?? "a");
      const [selection, setSelectionState] = useState<SelectionState | null>(selectionRef.current);
      const setLayers = (next: SetStateAction<Layer[]>) => {
        layersRef.current = typeof next === "function" ? next(layersRef.current) : next;
        return layersRef.current;
      };
      const setSelection = (next: SetStateAction<SelectionState | null>) => {
        selectionRef.current = typeof next === "function" ? next(selectionRef.current) : next;
        setSelectionState(selectionRef.current);
        return selectionRef.current;
      };
      const setActiveLayerPixelsState = (next: SetStateAction<PixelValue[]>) => {
        activePixelsRef.current = typeof next === "function" ? next(activePixelsRef.current) : next;
        return activePixelsRef.current;
      };
      const api = useMoveDrag({
        gridWidth: GRID,
        gridHeight: GRID,
        totalCells: TOTAL,
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
        ...history,
      });
      return { api, activeLayerId, selection };
    },
    { initialProps: { tool: options.tool ?? ("move" as ToolId), autoPickLayer: options.autoPickLayer ?? false } },
  );

  const press = (cellX: number, cellY: number, pointerId = 1) =>
    act(() => {
      const resolved = resolvePointerFromClientPoint(client(cellX, cellY).clientX, client(cellX, cellY).clientY);
      if (!resolved) throw new Error("unresolved");
      hook.result.current.api.beginMoveDrag(gridRef.current, pointerId, resolved);
    });
  const drag = (cellX: number, cellY: number, pointerId = 1) =>
    act(() => {
      const point = client(cellX, cellY);
      hook.result.current.api.updateMoveDrag(point.clientX, point.clientY, pointerId);
    });
  const finish = (cancelled: boolean, pointerId = 1) => {
    let handled = false;
    act(() => {
      handled = hook.result.current.api.finishMoveDrag(pointerId, cancelled);
    });
    return handled;
  };
  const layerPixels = (id: string) => layersRef.current.find((layer) => layer.id === id)?.pixels ?? [];

  return { hook, canvas, layersRef, selectionRef, activePixelsRef, history, press, drag, finish, layerPixels };
}

describe("useMoveDrag", () => {
  it("moves the active layer with the pointer, opening one history action after the first movement", () => {
    const { hook, canvas, history, press, drag, finish, layerPixels } = setup();
    press(1, 1);
    expect(hook.result.current.api.hasActiveDrag()).toBe(true);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(history.saveStacks).toHaveBeenCalledTimes(1);
    expect(history.beginActionWithSnapshot).not.toHaveBeenCalled();

    drag(1, 1);
    expect(history.beginActionWithSnapshot).not.toHaveBeenCalled();

    drag(2, 2);
    expect(history.beginActionWithSnapshot).toHaveBeenCalledTimes(1);
    expect(history.beginActionWithSnapshot.mock.calls[0][0]).toMatchObject({ activeLayerId: "a", selection: null });
    expect(layerPixels("a")[5]).toBeNull();
    expect(layerPixels("a")[2 * GRID + 2]).toBe("#b");

    drag(3, 1);
    expect(history.beginActionWithSnapshot).toHaveBeenCalledTimes(1);
    expect(layerPixels("a")[1 * GRID + 3]).toBe("#b");

    expect(finish(false)).toBe(true);
    expect(history.finalizeAction).toHaveBeenCalledTimes(1);
    expect(history.restoreStacks).not.toHaveBeenCalled();
    expect(hook.result.current.api.hasActiveDrag()).toBe(false);
    expect(canvas.isCaptured()).toBeNull();
  });

  it("ignores pointers that did not start the drag", () => {
    const { history, press, drag, finish, layerPixels } = setup();
    press(1, 1, 7);
    drag(2, 2, 3);
    expect(layerPixels("a")[5]).toBe("#b");
    expect(finish(false, 3)).toBe(false);
    expect(finish(false, 7)).toBe(true);
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("restores the layer, selection and history stacks when the drag is cancelled", () => {
    const selection: SelectionState = {
      rect: { x: 1, y: 1, width: 1, height: 1 },
      offset: { dx: 0, dy: 0 },
      pixels: [{ relX: 0, relY: 0, color: "#b" }],
      isFloating: false,
    };
    const { hook, history, selectionRef, press, drag, finish, layerPixels } = setup({ selection });
    const saved = { undo: [], redo: [] };
    history.saveStacks.mockReturnValueOnce(saved);
    press(1, 1);
    drag(2, 3);
    expect(hook.result.current.selection).toEqual({
      rect: { x: 2, y: 3, width: 1, height: 1 },
      offset: { dx: 0, dy: 0 },
      pixels: [{ relX: 0, relY: 0, color: "#b" }],
      isFloating: false,
    });

    finish(true);
    expect(layerPixels("a")[5]).toBe("#b");
    expect(selectionRef.current).toEqual(selection);
    expect(history.restoreStacks).toHaveBeenCalledWith(saved);
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("treats a drag that returns to its origin as unchanged and rolls history back", () => {
    const { history, press, drag, finish, layerPixels } = setup();
    press(1, 1);
    drag(2, 2);
    drag(1, 1);
    expect(layerPixels("a")[5]).toBe("#b");
    finish(false);
    expect(history.restoreStacks).toHaveBeenCalledTimes(1);
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("does nothing on release when the pointer never moved", () => {
    const { history, press, finish } = setup();
    press(1, 1);
    finish(false);
    expect(history.beginActionWithSnapshot).not.toHaveBeenCalled();
    expect(history.restoreStacks).not.toHaveBeenCalled();
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("auto-picks the topmost visible opaque layer under the pointer and restores the active layer on cancel", () => {
    const layers = [
      makeLayer("bottom", { 5: "#b" }),
      makeLayer("hidden", { 5: "#h" }),
      makeLayer("top", { 5: "transparent" }),
    ];
    layers[1].visible = false;
    const { hook, press, drag, finish, layerPixels } = setup({ layers, activeLayerId: "top", autoPickLayer: true });
    press(1, 1);
    expect(hook.result.current.activeLayerId).toBe("bottom");
    drag(2, 1);
    expect(layerPixels("bottom")[6]).toBe("#b");
    expect(layerPixels("top")[5]).toBe("transparent");

    finish(true);
    expect(hook.result.current.activeLayerId).toBe("top");
    expect(layerPixels("bottom")[5]).toBe("#b");
  });

  it("does not auto-pick while a selection exists", () => {
    const layers = [makeLayer("bottom", { 5: "#b" }), makeLayer("top")];
    const selection: SelectionState = { rect: { x: 0, y: 0, width: 1, height: 1 }, offset: { dx: 0, dy: 0 }, pixels: [], isFloating: false };
    const { hook, press } = setup({ layers, activeLayerId: "top", autoPickLayer: true, selection });
    press(1, 1);
    expect(hook.result.current.activeLayerId).toBe("top");
  });

  it("carries a floating selection's pixels along with the layer", () => {
    const selection: SelectionState = {
      rect: { x: 0, y: 0, width: 1, height: 1 },
      offset: { dx: 1, dy: 0 },
      pixels: [{ relX: 0, relY: 0, color: "#f" }],
      isFloating: true,
    };
    const { hook, press, drag, layerPixels } = setup({ selection });
    press(1, 1);
    drag(1, 2);
    // Floating pixel at (1,0) moves to (1,1); the layer pixel at (1,1) moves to (1,2).
    expect(layerPixels("a")[1 * GRID + 1]).toBe("#f");
    expect(layerPixels("a")[2 * GRID + 1]).toBe("#b");
    expect(hook.result.current.selection?.rect).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(hook.result.current.selection?.isFloating).toBe(false);
  });

  it("drops the selection when it is pushed entirely off the grid", () => {
    const selection: SelectionState = {
      rect: { x: 3, y: 3, width: 1, height: 1 },
      offset: { dx: 0, dy: 0 },
      pixels: [],
      isFloating: false,
    };
    const { hook, press, drag } = setup({ selection });
    press(0, 0);
    drag(1, 1);
    expect(hook.result.current.selection).toBeNull();
  });

  it("cancels an active drag when the tool changes or the window loses focus", () => {
    const first = setup();
    first.press(1, 1);
    first.drag(2, 2);
    first.hook.rerender({ tool: "pencil", autoPickLayer: false });
    expect(first.hook.result.current.api.hasActiveDrag()).toBe(false);
    expect(first.layerPixels("a")[5]).toBe("#b");
    expect(first.history.restoreStacks).toHaveBeenCalledTimes(1);

    const second = setup();
    second.press(1, 1);
    second.drag(2, 2);
    fireEvent.blur(window);
    expect(second.hook.result.current.api.hasActiveDrag()).toBe(false);
    expect(second.layerPixels("a")[5]).toBe("#b");
  });
});
