import { act, fireEvent, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { PreviewMask } from "../grid-geometry";
import type { LayerEdit } from "../layer-edit";
import { createBuffer, packColor, unpackColor, type DirtyRect, type PixelBuffer } from "../pixel-buffer";
import type { ToolId } from "../PixelPencilTools";
import type { Layer, SelectionState } from "../PixelPencilTypes";
import { useSelectionGestures, useSelectionState } from "./useSelection";

const GRID = 4;
const CELL = 10;

/** Client coordinates map to cells at 10px each; the canvas sits at the origin. */
const client = (cellX: number, cellY: number) => ({
  clientX: cellX * CELL + CELL / 2,
  clientY: cellY * CELL + CELL / 2,
});

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

const A = packColor("#aaaaaa");
const B = packColor("#bbbbbb");
const C = packColor("#cccccc");

const selectionOf = (rect: DirtyRect, values: number[] = []): SelectionState => {
  const data = new Uint32Array(rect.width * rect.height);
  data.set(values);
  return { rect, offset: { dx: 0, dy: 0 }, data, isFloating: false };
};

function setup(initial: { pixels?: PixelBuffer; tool?: ToolId } = {}) {
  const canvas = makeCanvas();
  const gridRef = { current: canvas as unknown as HTMLCanvasElement };
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  const gridWrapperRef = { current: wrapper };
  const layer: Layer = { id: "layer", name: "Layer", visible: true, pixels: initial.pixels ?? createBuffer(GRID, GRID) };
  const pixel = (index: number) => unpackColor(layer.pixels.data[index]);
  const edits: { layerId: string; rect: DirtyRect }[] = [];
  const editLayer = (layerId: string, rect: DirtyRect, mutate: LayerEdit) => {
    edits.push({ layerId, rect });
    return mutate(layer.pixels);
  };
  const beginAction = vi.fn();
  const finalizeAction = vi.fn();
  const resolvePointerFromClientPoint = (clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    return {
      cellX: Math.max(0, Math.min(GRID - 1, Math.floor(clientX / CELL))),
      cellY: Math.max(0, Math.min(GRID - 1, Math.floor(clientY / CELL))),
    };
  };

  const hook = renderHook(
    ({ tool }: { tool: ToolId }) => {
      const [pathPreview, setPathPreview] = useState<PreviewMask | null>({ mask: new Uint8Array(GRID * GRID).fill(1, 0, 1), bounds: { x: 0, y: 0, width: 1, height: 1 } });
      const state = useSelectionState({
        gridWidth: GRID,
        gridHeight: GRID,
        gridRef,
        getActiveLayer: () => layer,
        activeLayerId: "layer",
        editLayer,
        setPathPreview,
      });
      const gestures = useSelectionGestures({
        state,
        tool,
        gridWidth: GRID,
        gridHeight: GRID,
        gridWrapperRef,
        setPathPreview,
        resolvePointerFromClientPoint,
        beginAction,
        finalizeAction,
      });
      return { state, gestures, pathPreview };
    },
    { initialProps: { tool: initial.tool ?? ("rect-select" as ToolId) } },
  );

  const pressAt = (cellX: number, cellY: number, pointerId = 1) =>
    act(() =>
      hook.result.current.gestures.beginRectSelectGesture(
        gridRef.current,
        pointerId,
        cellX,
        cellY,
      ),
    );
  const dragTo = (cellX: number, cellY: number) => {
    const point = client(cellX, cellY);
    act(() => {
      hook.result.current.gestures.updateRectSelectionFromClientPoint(point.clientX, point.clientY);
    });
  };
  const releaseAt = (cellX: number, cellY: number, pointerId = 1) => {
    const point = client(cellX, cellY);
    let handled = false;
    act(() => {
      handled = hook.result.current.gestures.finalizeRectSelectionPointerUp({ ...point, pointerId });
    });
    return handled;
  };

  return { hook, canvas, wrapper, layer, pixel, edits, beginAction, finalizeAction, pressAt, dragTo, releaseAt };
}

const filled = (): PixelBuffer => {
  const buffer = createBuffer(GRID, GRID);
  buffer.data[0] = A;
  buffer.data[5] = B; // (1,1)
  buffer.data[6] = C; // (2,1)
  return buffer;
};

describe("useSelectionState", () => {
  it("captures and applies selection data with clipping at the grid edge", () => {
    const { hook, layer, pixel, edits } = setup({ pixels: filled() });
    const { captureSelectionPixels, applySelectionToLayer } = hook.result.current.state;
    const captured = captureSelectionPixels({ x: 1, y: 1, width: 2, height: 1 });
    expect(Array.from(captured)).toEqual([B, C]);

    // Cells of a rect that hang off the grid capture as empty.
    expect(Array.from(captureSelectionPixels({ x: 1, y: 3, width: 2, height: 2 }))).toEqual([0, 0, 0, 0]);
    const other = createBuffer(GRID, GRID);
    other.data[3 * GRID + 3] = A;
    expect(Array.from(captureSelectionPixels({ x: 3, y: 3, width: 2, height: 2 }, other))).toEqual([A, 0, 0, 0]);

    const selection = { ...selectionOf({ x: 1, y: 1, width: 2, height: 1 }), data: captured };
    act(() => applySelectionToLayer(selection, { dx: 0, dy: 0 }, "clear"));
    expect(pixel(5)).toBeNull();
    expect(pixel(6)).toBeNull();
    expect(edits[edits.length - 1]).toEqual({ layerId: "layer", rect: { x: 1, y: 1, width: 2, height: 1 } });

    // Applying at an offset that pushes one pixel off-grid writes only the in-bounds one,
    // and the edit is bounded by the shifted rect clipped to the grid.
    act(() => applySelectionToLayer(selection, { dx: 2, dy: 1 }, "apply"));
    expect(pixel(2 * GRID + 3)).toBe("#bbbbbb");
    expect(Array.from(layer.pixels.data).filter((value) => value === C)).toHaveLength(0);
    expect(edits[edits.length - 1].rect).toEqual({ x: 3, y: 2, width: 1, height: 1 });

    // Empty selection cells are left alone by both modes.
    layer.pixels.data[2 * GRID + 3] = A;
    const sparse = selectionOf({ x: 2, y: 2, width: 2, height: 1 }, [B, 0]);
    act(() => applySelectionToLayer(sparse, { dx: 0, dy: 0 }, "apply"));
    expect(pixel(2 * GRID + 2)).toBe("#bbbbbb");
    expect(pixel(2 * GRID + 3)).toBe("#aaaaaa");
    act(() => applySelectionToLayer(sparse, { dx: 0, dy: 0 }, "clear"));
    expect(pixel(2 * GRID + 2)).toBeNull();
    expect(pixel(2 * GRID + 3)).toBe("#aaaaaa");

    // A selection pushed entirely off the grid makes no edit.
    const editCount = edits.length;
    act(() => applySelectionToLayer(selection, { dx: 5, dy: 0 }, "apply"));
    expect(edits).toHaveLength(editCount);
  });

  it("normalizes rects to the grid and clamps offsets so the selection stays on it", () => {
    const { hook } = setup();
    const { normalizeSelectionRect, clampSelectionOffset, selectionContainsCell } = hook.result.current.state;
    expect(normalizeSelectionRect({ x: 9, y: -3 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 0, width: 3, height: 3 });

    const rect = { x: 1, y: 1, width: 2, height: 2 };
    expect(clampSelectionOffset(rect, { dx: -10, dy: 10 })).toEqual({ dx: -2, dy: 2 });
    const selection = { ...selectionOf(rect), offset: { dx: 1, dy: 0 } };
    expect(selectionContainsCell(selection, 2, 1)).toBe(true);
    expect(selectionContainsCell(selection, 1, 1)).toBe(false);
  });

  it("restores a selection from history as a copy and abandons the gesture in progress", () => {
    const { hook, canvas, pressAt } = setup({ pixels: filled() });
    pressAt(0, 0);
    expect(hook.result.current.state.gestureRef.current.draftOrigin).toEqual({ x: 0, y: 0 });
    expect(canvas.isCaptured()).toBe(1);

    const restored = selectionOf({ x: 2, y: 2, width: 1, height: 1 });
    act(() => hook.result.current.state.restoreSelection(restored));
    expect(hook.result.current.state.selection).toEqual(restored);
    expect(hook.result.current.state.selection).not.toBe(restored);
    expect(hook.result.current.state.selectionPreviewRect).toBeNull();
    expect(hook.result.current.state.gestureRef.current.draftOrigin).toBeNull();
    expect(canvas.isCaptured()).toBeNull();
  });
});

describe("useSelectionGestures", () => {
  it("draws a rectangle: preview while dragging, selection with pixels on release", () => {
    const { hook, canvas, pressAt, dragTo, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(hook.result.current.state.selectionPreviewRect).toEqual({ x: 1, y: 1, width: 1, height: 1 });
    expect(hook.result.current.pathPreview).toBeNull();

    dragTo(2, 3);
    expect(hook.result.current.state.selectionPreviewRect).toEqual({ x: 1, y: 1, width: 2, height: 3 });
    expect(hook.result.current.state.selection).toBeNull();

    expect(releaseAt(2, 3)).toBe(true);
    expect(hook.result.current.state.selectionPreviewRect).toBeNull();
    expect(hook.result.current.state.selection).toEqual(
      selectionOf({ x: 1, y: 1, width: 2, height: 3 }, [B, C, 0, 0, 0, 0]),
    );
    expect(canvas.isCaptured()).toBeNull();
  });

  it("uses the last dragged cell when the pointer is released off-canvas", () => {
    const { hook, pressAt, dragTo } = setup();
    pressAt(0, 0);
    dragTo(2, 2);
    act(() => {
      hook.result.current.gestures.finalizeRectSelectionPointerUp({ clientX: Number.NaN, clientY: Number.NaN, pointerId: 1 });
    });
    expect(hook.result.current.state.selection?.rect).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });

  it("clicking outside a selection cancels it without starting a new one, unless the pointer drags", () => {
    const { hook, pressAt, dragTo, releaseAt } = setup();
    pressAt(0, 0);
    releaseAt(0, 0);
    expect(hook.result.current.state.selection?.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });

    pressAt(3, 3);
    releaseAt(3, 3);
    expect(hook.result.current.state.selection).toBeNull();

    pressAt(3, 3);
    dragTo(2, 2);
    releaseAt(2, 2);
    expect(hook.result.current.state.selection?.rect).toEqual({ x: 2, y: 2, width: 2, height: 2 });
  });

  it("drags a selection with pixels inside one history action and commits it at the new place", () => {
    const { hook, pixel, beginAction, finalizeAction, pressAt, dragTo, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    releaseAt(2, 1);
    expect(beginAction).not.toHaveBeenCalled();

    pressAt(1, 1);
    expect(beginAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.selection?.isFloating).toBe(true);
    expect(pixel(5)).toBeNull();
    expect(pixel(6)).toBeNull();

    dragTo(1, 3);
    expect(hook.result.current.state.selection?.offset).toEqual({ dx: 0, dy: 2 });
    // The offset is clamped so the selection stays on the grid.
    dragTo(3, 3);
    expect(hook.result.current.state.selection?.offset).toEqual({ dx: 2, dy: 2 });
    expect(finalizeAction).not.toHaveBeenCalled();

    releaseAt(3, 3);
    expect(finalizeAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.selection).toMatchObject({
      rect: { x: 3, y: 3, width: 2, height: 1 },
      offset: { dx: 0, dy: 0 },
      isFloating: false,
    });
    expect(pixel(3 * GRID + 3)).toBe("#bbbbbb");
  });

  it("dragging an empty selection opens no history action", () => {
    const { beginAction, finalizeAction, pressAt, dragTo, releaseAt } = setup();
    pressAt(0, 0);
    releaseAt(1, 1);
    pressAt(0, 0);
    dragTo(1, 1);
    releaseAt(1, 1);
    expect(beginAction).not.toHaveBeenCalled();
    expect(finalizeAction).not.toHaveBeenCalled();
  });

  it("cancelling a floating selection applies its pixels where they are and ends the action", () => {
    const { hook, pixel, finalizeAction, pressAt, dragTo, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    releaseAt(2, 1);
    pressAt(1, 1);
    dragTo(1, 2);
    expect(pixel(5)).toBeNull();

    let cancelled = false;
    act(() => {
      cancelled = hook.result.current.gestures.cancelSelection();
    });
    expect(cancelled).toBe(true);
    expect(hook.result.current.state.selection).toBeNull();
    expect(pixel(2 * GRID + 1)).toBe("#bbbbbb");
    expect(finalizeAction).toHaveBeenCalledTimes(1);

    act(() => {
      cancelled = hook.result.current.gestures.cancelSelection();
    });
    expect(cancelled).toBe(false);
  });

  it("deletes the selected pixels inside a history action", () => {
    const { hook, pixel, beginAction, finalizeAction, pressAt, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    releaseAt(2, 1);
    act(() => hook.result.current.gestures.deleteSelection());
    expect(pixel(5)).toBeNull();
    expect(pixel(6)).toBeNull();
    expect(pixel(0)).toBe("#aaaaaa");
    expect(beginAction).toHaveBeenCalledTimes(1);
    expect(finalizeAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.selection).toBeNull();
  });

  it("selects the entire canvas", () => {
    const { hook } = setup({ pixels: filled() });
    act(() => hook.result.current.gestures.selectEntireCanvas());
    expect(hook.result.current.state.selection?.rect).toEqual({ x: 0, y: 0, width: GRID, height: GRID });
    const data = Array.from(hook.result.current.state.selection?.data ?? []);
    expect(data).toHaveLength(GRID * GRID);
    expect(data.filter((value) => value !== 0)).toEqual([A, B, C]);
  });

  it("handles Delete, Escape and Ctrl/Cmd+A on the window but not inside inputs", () => {
    const { hook, pixel, pressAt, releaseAt } = setup({ pixels: filled() });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(hook.result.current.state.selection?.rect.width).toBe(GRID);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(hook.result.current.state.selection).toBeNull();

    pressAt(1, 1);
    releaseAt(2, 1);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(pixel(5)).toBe("#bbbbbb");

    fireEvent.keyDown(window, { key: "Delete" });
    expect(pixel(5)).toBeNull();
    expect(hook.result.current.state.selection).toBeNull();
    input.remove();
  });

  it("cancels the selection on a pointer-down outside the grid wrapper, except on tool controls", () => {
    const { hook, wrapper, pressAt, releaseAt } = setup();
    pressAt(0, 0);
    releaseAt(1, 1);

    const inside = document.createElement("span");
    wrapper.appendChild(inside);
    fireEvent.pointerDown(inside);
    expect(hook.result.current.state.selection).not.toBeNull();

    const toolButton = document.createElement("button");
    toolButton.setAttribute("data-pixel-tool", "");
    document.body.appendChild(toolButton);
    fireEvent.pointerDown(toolButton);
    expect(hook.result.current.state.selection).not.toBeNull();

    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    fireEvent.pointerDown(elsewhere);
    expect(hook.result.current.state.selection).toBeNull();
  });

  it("cancels on a background pointer-down unless the move tool is active", () => {
    const { hook, pressAt, releaseAt } = setup();
    pressAt(0, 0);
    releaseAt(1, 1);
    const event = { preventDefault: vi.fn() };

    hook.rerender({ tool: "move" });
    act(() => hook.result.current.gestures.handleSelectionBackgroundPointerDown(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(hook.result.current.state.selection).not.toBeNull();

    hook.rerender({ tool: "pencil" });
    act(() => hook.result.current.gestures.handleSelectionBackgroundPointerDown(event));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.selection).toBeNull();
  });

  it("finishes a gesture from a window-level release (mouse fallback without PointerEvent)", () => {
    const { hook, pressAt, dragTo } = setup();
    expect(typeof window.PointerEvent).toBe("undefined");
    pressAt(0, 0, 7);
    dragTo(1, 1);
    fireEvent.mouseUp(window, client(1, 1));
    expect(hook.result.current.state.selection?.rect).toEqual({ x: 0, y: 0, width: 2, height: 2 });
  });

  it("releases pointer capture when the tool changes away from rect-select and ignores pointer-up then", () => {
    const { hook, canvas, pressAt, releaseAt } = setup();
    pressAt(0, 0);
    expect(canvas.isCaptured()).toBe(1);
    hook.rerender({ tool: "pencil" });
    expect(canvas.isCaptured()).toBeNull();
    expect(releaseAt(1, 1)).toBe(false);
  });
});
