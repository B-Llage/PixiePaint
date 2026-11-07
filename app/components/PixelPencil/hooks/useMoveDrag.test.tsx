import { act, fireEvent, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LayerEdit } from "../layer-edit";
import {
  createBuffer,
  toPackedValue,
  unpackColor,
  type DirtyRect,
} from "../pixel-buffer";
import type { ToolId } from "../PixelPencilTools";
import type { Layer, PixelValue, SelectionRect, SelectionState } from "../PixelPencilTypes";
import { useMoveDrag } from "./useMoveDrag";

const GRID = 4;
const CELL = 10;

const B = toPackedValue("#bbbbbb");
const F = toPackedValue("#ffffff");

const client = (cellX: number, cellY: number) => ({
  clientX: cellX * CELL + CELL / 2,
  clientY: cellY * CELL + CELL / 2,
});

const makeLayer = (id: string, filledIndices: Record<number, PixelValue> = {}): Layer => {
  const pixels = createBuffer(GRID, GRID);
  for (const [index, color] of Object.entries(filledIndices)) {
    pixels.data[Number(index)] = toPackedValue(color);
  }
  return { id, name: id, pixels, visible: true };
};

const selectionOf = (rect: SelectionRect, values: number[], extra: Partial<SelectionState> = {}): SelectionState => {
  const data = new Uint32Array(rect.width * rect.height);
  data.set(values);
  return { rect, offset: { dx: 0, dy: 0 }, data, isFloating: false, ...extra };
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
  const layersRef = { current: options.layers ?? [makeLayer("a", { 5: "#bbbbbb" })] };
  const selectionRef = { current: options.selection ?? null };
  const edits: { layerId: string; rect: DirtyRect }[] = [];
  /** How many edits had been made each time `beginAction` ran. */
  const editsAtBeginAction: number[] = [];
  const history = {
    saveStacks: vi.fn(() => ({ undo: [], redo: [] })),
    restoreStacks: vi.fn(),
    beginAction: vi.fn(() => {
      editsAtBeginAction.push(edits.length);
    }),
    finalizeAction: vi.fn(),
  };
  const getLayerBuffer = (layerId: string) => layersRef.current.find((layer) => layer.id === layerId)?.pixels ?? null;
  const editLayer = vi.fn((layerId: string, rect: DirtyRect, mutate: LayerEdit) => {
    edits.push({ layerId, rect });
    const buffer = getLayerBuffer(layerId);
    return buffer ? mutate(buffer) : null;
  });
  const resolvePointerFromClientPoint = (clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const cellX = Math.max(0, Math.min(GRID - 1, Math.floor(clientX / CELL)));
    const cellY = Math.max(0, Math.min(GRID - 1, Math.floor(clientY / CELL)));
    return { index: cellY * GRID + cellX, cellX, cellY };
  };

  const hook = renderHook(
    ({ tool, autoPickLayer }: Props) => {
      const [activeLayerId, setActiveLayerId] = useState(options.activeLayerId ?? "a");
      const [selection, setSelectionState] = useState<SelectionState | null>(selectionRef.current);
      const setSelection = (next: SetStateAction<SelectionState | null>) => {
        selectionRef.current = typeof next === "function" ? next(selectionRef.current) : next;
        setSelectionState(selectionRef.current);
        return selectionRef.current;
      };
      const api = useMoveDrag({
        gridWidth: GRID,
        gridHeight: GRID,
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
  const layerPixels = (id: string) =>
    Array.from(getLayerBuffer(id)?.data ?? [], (value) => unpackColor(value));

  return { hook, canvas, layersRef, selectionRef, history, edits, editsAtBeginAction, press, drag, finish, layerPixels };
}

describe("useMoveDrag", () => {
  it("moves the active layer with the pointer, opening one history action after the first movement", () => {
    const { hook, canvas, history, editsAtBeginAction, press, drag, finish, layerPixels } = setup();
    press(1, 1);
    expect(hook.result.current.api.hasActiveDrag()).toBe(true);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(history.saveStacks).toHaveBeenCalledTimes(1);
    expect(history.beginAction).not.toHaveBeenCalled();

    drag(1, 1);
    expect(history.beginAction).not.toHaveBeenCalled();

    drag(2, 2);
    expect(history.beginAction).toHaveBeenCalledTimes(1);
    // The action opens before the first write, so its before-metadata predates the move.
    expect(editsAtBeginAction).toEqual([0]);
    expect(layerPixels("a")[5]).toBeNull();
    expect(layerPixels("a")[2 * GRID + 2]).toBe("#bbbbbb");

    drag(3, 1);
    expect(history.beginAction).toHaveBeenCalledTimes(1);
    expect(layerPixels("a")[1 * GRID + 3]).toBe("#bbbbbb");
    expect(layerPixels("a").filter((value) => value !== null)).toHaveLength(1);

    expect(finish(false)).toBe(true);
    expect(history.finalizeAction).toHaveBeenCalledTimes(1);
    expect(history.restoreStacks).not.toHaveBeenCalled();
    expect(hook.result.current.api.hasActiveDrag()).toBe(false);
    expect(canvas.isCaptured()).toBeNull();
  });

  it("moves pixels by writing only the union of before and after bounds", () => {
    const { edits, press, drag, layerPixels } = setup();
    press(1, 1);
    expect(edits).toHaveLength(0);

    drag(2, 2);
    expect(edits).toEqual([{ layerId: "a", rect: { x: 1, y: 1, width: 2, height: 2 } }]);

    // The next step also covers the previous position so the sprite left behind is cleared.
    drag(3, 1);
    expect(edits[1]).toEqual({ layerId: "a", rect: { x: 1, y: 1, width: 3, height: 2 } });
    expect(layerPixels("a")[2 * GRID + 2]).toBeNull();

  });

  it("clips the written rect to the grid when the sprite is pushed off an edge", () => {
    const { edits, press, drag, layerPixels } = setup();
    press(3, 1);
    drag(2, 2);
    expect(edits[0].rect).toEqual({ x: 0, y: 1, width: 2, height: 2 });
    expect(layerPixels("a")[2 * GRID]).toBe("#bbbbbb");

    // Three cells left puts the sprite at x = -2: only its source and last bounds are written.
    drag(0, 1);
    expect(edits[1].rect).toEqual({ x: 0, y: 1, width: 2, height: 2 });
    expect(layerPixels("a").every((value) => value === null)).toBe(true);
  });

  it("ignores pointers that did not start the drag", () => {
    const { history, press, drag, finish, layerPixels } = setup();
    press(1, 1, 7);
    drag(2, 2, 3);
    expect(layerPixels("a")[5]).toBe("#bbbbbb");
    expect(finish(false, 3)).toBe(false);
    expect(finish(false, 7)).toBe(true);
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("restores the layer, selection and history stacks when the drag is cancelled", () => {
    const selection = selectionOf({ x: 1, y: 1, width: 1, height: 1 }, [B]);
    const { hook, history, selectionRef, edits, press, drag, finish, layerPixels } = setup({ selection });
    const saved = { undo: [], redo: [] };
    history.saveStacks.mockReturnValueOnce(saved);
    press(1, 1);
    drag(2, 3);
    expect(hook.result.current.selection).toEqual(selectionOf({ x: 2, y: 3, width: 1, height: 1 }, [B]));
    expect(layerPixels("a")[3 * GRID + 2]).toBe("#bbbbbb");

    finish(true);
    expect(layerPixels("a")[5]).toBe("#bbbbbb");
    expect(layerPixels("a")[3 * GRID + 2]).toBeNull();
    // The restore writes back over the source and last bounds only.
    expect(edits[edits.length - 1].rect).toEqual({ x: 1, y: 1, width: 2, height: 3 });
    expect(selectionRef.current).toEqual(selection);
    expect(history.restoreStacks).toHaveBeenCalledWith(saved);
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("treats a drag that returns to its origin as unchanged and rolls history back", () => {
    const { history, press, drag, finish, layerPixels } = setup();
    press(1, 1);
    drag(2, 2);
    drag(1, 1);
    expect(layerPixels("a")[5]).toBe("#bbbbbb");
    expect(layerPixels("a")[2 * GRID + 2]).toBeNull();
    finish(false);
    expect(history.restoreStacks).toHaveBeenCalledTimes(1);
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("does nothing on release when the pointer never moved", () => {
    const { history, press, finish } = setup();
    press(1, 1);
    finish(false);
    expect(history.beginAction).not.toHaveBeenCalled();
    expect(history.restoreStacks).not.toHaveBeenCalled();
    expect(history.finalizeAction).not.toHaveBeenCalled();
  });

  it("auto-picks the topmost visible opaque layer under the pointer and restores the active layer on cancel", () => {
    const layers = [
      makeLayer("bottom", { 5: "#bbbbbb" }),
      makeLayer("hidden", { 5: "#999999" }),
      makeLayer("top", { 5: "transparent" }),
    ];
    layers[1].visible = false;
    const { hook, press, drag, finish, layerPixels } = setup({ layers, activeLayerId: "top", autoPickLayer: true });
    press(1, 1);
    expect(hook.result.current.activeLayerId).toBe("bottom");
    drag(2, 1);
    expect(layerPixels("bottom")[6]).toBe("#bbbbbb");
    expect(layerPixels("top")[5]).toBe("transparent");

    finish(true);
    expect(hook.result.current.activeLayerId).toBe("top");
    expect(layerPixels("bottom")[5]).toBe("#bbbbbb");
  });

  it("does not auto-pick while a selection exists", () => {
    const layers = [makeLayer("bottom", { 5: "#bbbbbb" }), makeLayer("top")];
    const selection = selectionOf({ x: 0, y: 0, width: 1, height: 1 }, []);
    const { hook, press } = setup({ layers, activeLayerId: "top", autoPickLayer: true, selection });
    press(1, 1);
    expect(hook.result.current.activeLayerId).toBe("top");
  });

  it("carries a floating selection's pixels along with the layer", () => {
    const selection = selectionOf({ x: 0, y: 0, width: 1, height: 1 }, [F], { offset: { dx: 1, dy: 0 }, isFloating: true });
    const { hook, press, drag, layerPixels } = setup({ selection });
    press(1, 1);
    drag(1, 2);
    // Floating pixel at (1,0) moves to (1,1); the layer pixel at (1,1) moves to (1,2).
    expect(layerPixels("a")[1 * GRID + 1]).toBe("#ffffff");
    expect(layerPixels("a")[2 * GRID + 1]).toBe("#bbbbbb");
    expect(hook.result.current.selection?.rect).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(hook.result.current.selection?.isFloating).toBe(false);
  });

  it("drops the selection when it is pushed entirely off the grid", () => {
    const selection = selectionOf({ x: 3, y: 3, width: 1, height: 1 }, []);
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
    expect(first.layerPixels("a")[5]).toBe("#bbbbbb");
    expect(first.history.restoreStacks).toHaveBeenCalledTimes(1);

    const second = setup();
    second.press(1, 1);
    second.drag(2, 2);
    fireEvent.blur(window);
    expect(second.hook.result.current.api.hasActiveDrag()).toBe(false);
    expect(second.layerPixels("a")[5]).toBe("#bbbbbb");
  });
});
