import { act, fireEvent, renderHook } from "@testing-library/react";
import { useState } from "react";
import type { SetStateAction } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ToolId } from "../PixelPencilTools";
import type { PixelValue } from "../PixelPencilTypes";
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

function setup(initial: { pixels?: PixelValue[]; tool?: ToolId } = {}) {
  const canvas = makeCanvas();
  const gridRef = { current: canvas as unknown as HTMLCanvasElement };
  const wrapper = document.createElement("div");
  document.body.appendChild(wrapper);
  const gridWrapperRef = { current: wrapper };
  const pixelsRef = { current: initial.pixels ?? new Array<PixelValue>(GRID * GRID).fill(null) };
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
      const [pathPreview, setPathPreview] = useState<Set<number> | null>(new Set([0]));
      const setActiveLayerPixels = (next: SetStateAction<PixelValue[]>) => {
        pixelsRef.current = typeof next === "function" ? next(pixelsRef.current) : next;
      };
      const state = useSelectionState({
        gridWidth: GRID,
        gridHeight: GRID,
        gridRef,
        activeLayerPixelsRef: pixelsRef,
        setActiveLayerPixels,
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

  return { hook, canvas, wrapper, pixelsRef, beginAction, finalizeAction, pressAt, dragTo, releaseAt };
}

const filled = (): PixelValue[] => {
  const pixels = new Array<PixelValue>(GRID * GRID).fill(null);
  pixels[0] = "#a";
  pixels[5] = "#b"; // (1,1)
  pixels[6] = "#c"; // (2,1)
  return pixels;
};

describe("useSelectionState", () => {
  it("captures only non-empty pixels inside the rect and applies or clears them at an offset", () => {
    const { hook, pixelsRef } = setup({ pixels: filled() });
    const { captureSelectionPixels, applySelectionToLayer } = hook.result.current.state;
    const captured = captureSelectionPixels({ x: 1, y: 1, width: 2, height: 1 });
    expect(captured).toEqual([
      { relX: 0, relY: 0, color: "#b" },
      { relX: 1, relY: 0, color: "#c" },
    ]);

    const selection = { rect: { x: 1, y: 1, width: 2, height: 1 }, offset: { dx: 0, dy: 0 }, pixels: captured, isFloating: false };
    act(() => applySelectionToLayer(selection, { dx: 0, dy: 0 }, "clear"));
    expect(pixelsRef.current[5]).toBeNull();
    expect(pixelsRef.current[6]).toBeNull();

    // Applying at an offset that pushes one pixel off-grid writes only the in-bounds one.
    act(() => applySelectionToLayer(selection, { dx: 2, dy: 1 }, "apply"));
    expect(pixelsRef.current[2 * GRID + 3]).toBe("#b");
    expect(pixelsRef.current.filter((value) => value === "#c")).toHaveLength(0);
  });

  it("normalizes rects to the grid and clamps offsets so the selection stays on it", () => {
    const { hook } = setup();
    const { normalizeSelectionRect, clampSelectionOffset, selectionContainsCell } = hook.result.current.state;
    expect(normalizeSelectionRect({ x: 9, y: -3 }, { x: 1, y: 2 })).toEqual({ x: 1, y: 0, width: 3, height: 3 });

    const rect = { x: 1, y: 1, width: 2, height: 2 };
    expect(clampSelectionOffset(rect, { dx: -10, dy: 10 })).toEqual({ dx: -2, dy: 2 });
    const selection = { rect, offset: { dx: 1, dy: 0 }, pixels: [], isFloating: false };
    expect(selectionContainsCell(selection, 2, 1)).toBe(true);
    expect(selectionContainsCell(selection, 1, 1)).toBe(false);
  });

  it("restores a selection from history as a copy and abandons the gesture in progress", () => {
    const { hook, canvas, pressAt } = setup({ pixels: filled() });
    pressAt(0, 0);
    expect(hook.result.current.state.gestureRef.current.draftOrigin).toEqual({ x: 0, y: 0 });
    expect(canvas.isCaptured()).toBe(1);

    const restored = { rect: { x: 2, y: 2, width: 1, height: 1 }, offset: { dx: 0, dy: 0 }, pixels: [], isFloating: false };
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
    expect(hook.result.current.state.selection).toEqual({
      rect: { x: 1, y: 1, width: 2, height: 3 },
      offset: { dx: 0, dy: 0 },
      pixels: [
        { relX: 0, relY: 0, color: "#b" },
        { relX: 1, relY: 0, color: "#c" },
      ],
      isFloating: false,
    });
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
    const { hook, pixelsRef, beginAction, finalizeAction, pressAt, dragTo, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    releaseAt(2, 1);
    expect(beginAction).not.toHaveBeenCalled();

    pressAt(1, 1);
    expect(beginAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.selection?.isFloating).toBe(true);
    expect(pixelsRef.current[5]).toBeNull();
    expect(pixelsRef.current[6]).toBeNull();

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
    expect(pixelsRef.current[3 * GRID + 3]).toBe("#b");
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
    const { hook, pixelsRef, finalizeAction, pressAt, dragTo, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    releaseAt(2, 1);
    pressAt(1, 1);
    dragTo(1, 2);
    expect(pixelsRef.current[5]).toBeNull();

    let cancelled = false;
    act(() => {
      cancelled = hook.result.current.gestures.cancelSelection();
    });
    expect(cancelled).toBe(true);
    expect(hook.result.current.state.selection).toBeNull();
    expect(pixelsRef.current[2 * GRID + 1]).toBe("#b");
    expect(finalizeAction).toHaveBeenCalledTimes(1);

    act(() => {
      cancelled = hook.result.current.gestures.cancelSelection();
    });
    expect(cancelled).toBe(false);
  });

  it("deletes the selected pixels inside a history action", () => {
    const { hook, pixelsRef, beginAction, finalizeAction, pressAt, releaseAt } = setup({ pixels: filled() });
    pressAt(1, 1);
    releaseAt(2, 1);
    act(() => hook.result.current.gestures.deleteSelection());
    expect(pixelsRef.current[5]).toBeNull();
    expect(pixelsRef.current[6]).toBeNull();
    expect(pixelsRef.current[0]).toBe("#a");
    expect(beginAction).toHaveBeenCalledTimes(1);
    expect(finalizeAction).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.selection).toBeNull();
  });

  it("selects the entire canvas", () => {
    const { hook } = setup({ pixels: filled() });
    act(() => hook.result.current.gestures.selectEntireCanvas());
    expect(hook.result.current.state.selection?.rect).toEqual({ x: 0, y: 0, width: GRID, height: GRID });
    expect(hook.result.current.state.selection?.pixels).toHaveLength(3);
  });

  it("handles Delete, Escape and Ctrl/Cmd+A on the window but not inside inputs", () => {
    const { hook, pixelsRef, pressAt, releaseAt } = setup({ pixels: filled() });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(hook.result.current.state.selection?.rect.width).toBe(GRID);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(hook.result.current.state.selection).toBeNull();

    pressAt(1, 1);
    releaseAt(2, 1);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(pixelsRef.current[5]).toBe("#b");

    fireEvent.keyDown(window, { key: "Delete" });
    expect(pixelsRef.current[5]).toBeNull();
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
