import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LayerEdit } from "../layer-edit";
import { createBuffer, unpackColor, type DirtyRect } from "../pixel-buffer";
import type { ToolId } from "../PixelPencilTools";
import type { BrushShape } from "../PixelPencilTypes";
import { useStrokePipeline } from "./useStrokePipeline";

const GRID = 8;
const CELL = 10;

const client = (x: number, y: number) => ({ clientX: x * CELL, clientY: y * CELL });

type Props = { tool: ToolId; brushSize: number; brushShape: BrushShape; previewToolEffects: boolean };

function setup(initial: Partial<Props> = {}) {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  const runFrames = () =>
    act(() => {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame(0);
    });

  const buffer = createBuffer(GRID, GRID);
  /** Each edit's requested rect and the rect the mutation reported changed. */
  const edits: { layerId: string; rect: DirtyRect; changed: DirtyRect | null }[] = [];
  const editLayer = vi.fn((layerId: string, rect: DirtyRect, mutate: LayerEdit) => {
    const changed = mutate(buffer);
    edits.push({ layerId, rect, changed });
    return changed;
  });
  const finalizeAction = vi.fn();
  const setDrawValue = vi.fn();
  const setHoverIndexIfChanged = vi.fn();
  const resolvePointerFromClientPoint = vi.fn((clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    const x = clientX / CELL;
    const y = clientY / CELL;
    const cellX = Math.max(0, Math.min(GRID - 1, Math.floor(x)));
    const cellY = Math.max(0, Math.min(GRID - 1, Math.floor(y)));
    return { index: cellY * GRID + cellX, position: { x, y } };
  });

  const hook = renderHook(
    (props: Props) => {
      const [pathPreview, setPathPreview] = useState<Set<number> | null>(null);
      const [dragStartIndex, setDragStartIndex] = useState<number | null>(3);
      const api = useStrokePipeline({
        gridWidth: GRID,
        gridHeight: GRID,
        ...props,
        activeLayerId: "layer",
        editLayer,
        setPathPreview,
        setDragStartIndex,
        setDrawValue,
        setHoverIndexIfChanged,
        resolvePointerFromClientPoint,
        finalizeAction,
      });
      return { api, pathPreview, dragStartIndex };
    },
    {
      initialProps: {
        tool: "pencil" as ToolId,
        brushSize: 1,
        brushShape: "square" as BrushShape,
        previewToolEffects: true,
        ...initial,
      },
    },
  );

  const painted = () =>
    Array.from(buffer.data).flatMap((value, index) => (unpackColor(value) === null ? [] : [index]));

  return { hook, buffer, edits, painted, runFrames, finalizeAction, setDrawValue, setHoverIndexIfChanged };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useStrokePipeline", () => {
  it("paints the brush footprint inside its bounds and reports a change only when pixels change", () => {
    const { hook, buffer, edits, painted } = setup({ brushSize: 2 });
    act(() => hook.result.current.api.applyBrush(9, "#f00"));
    expect(painted()).toEqual([9, 10, 17, 18]);
    expect(unpackColor(buffer.data[9])).toBe("#ff0000");
    expect(edits).toEqual([
      { layerId: "layer", rect: { x: 1, y: 1, width: 2, height: 2 }, changed: { x: 1, y: 1, width: 2, height: 2 } },
    ]);

    act(() => hook.result.current.api.applyBrush(9, "#f00"));
    expect(edits[1].changed).toBeNull();
  });

  it("clips the brush bounds at the grid edge and erases with null", () => {
    const { hook, edits, painted } = setup({ brushSize: 3 });
    act(() => hook.result.current.api.applyBrush(0, "#f00"));
    expect(edits[0].rect).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(painted()).toEqual([0, 1, 8, 9]);

    act(() => hook.result.current.api.applyBrush(0, null));
    expect(painted()).toEqual([]);
  });

  it("paints a path with the brush in one edit bounded by the path and previews it", () => {
    const { hook, edits, painted } = setup();
    act(() => hook.result.current.api.applyLinePath([0, 1, 2], "#0f0"));
    expect(painted()).toEqual([0, 1, 2]);
    expect(edits).toHaveLength(1);
    expect(edits[0].rect).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    expect(hook.result.current.api.buildLinePreview([0, 9])).toEqual(new Set([0, 9]));

    act(() => hook.result.current.api.applyLinePath([], "#0f0"));
    expect(edits).toHaveLength(1);
    act(() => hook.result.current.api.applyLinePath([0, 1, 2], "#0f0"));
    expect(edits[1].changed).toBeNull();

    // The scratch mask is cleared between edits: a later path paints only its own cells.
    act(() => hook.result.current.api.applyLinePath([16], "#00f"));
    expect(painted()).toEqual([0, 1, 2, 16]);
    expect(edits[2].rect).toEqual({ x: 0, y: 2, width: 1, height: 1 });
  });

  it("runs a freehand stroke: first cell on press, traced cells on commit, reset on stop", () => {
    const { hook, edits, painted, finalizeAction, setDrawValue } = setup();
    const api = () => hook.result.current.api;
    act(() => api().beginStroke({ index: 0, position: { x: 0.5, y: 0.5 } }, "#f00", true));
    expect(api().isDrawingRef.current).toBe(true);
    expect(api().lastPaintedIndexRef.current).toBe(0);
    expect(setDrawValue).toHaveBeenCalledWith("#f00");
    expect(painted()).toEqual([0]);
    expect(hook.result.current.pathPreview).toEqual(new Set([0]));

    act(() => api().appendStrokePoint({ x: 0.505, y: 0.5 }));
    expect(hook.result.current.pathPreview).toEqual(new Set([0]));
    act(() => api().appendStrokePoint({ x: 2.5, y: 0.5 }));
    expect(hook.result.current.pathPreview).toEqual(new Set([0, 1, 2]));
    expect(painted()).toEqual([0]);

    act(() => api().commitStrokeBuffer("#f00"));
    expect(painted()).toEqual([0, 1, 2]);
    expect(edits[edits.length - 1].rect).toEqual({ x: 0, y: 0, width: 3, height: 1 });

    act(() => api().stopStroke());
    expect(api().isDrawingRef.current).toBe(false);
    expect(api().activePointerIdRef.current).toBeNull();
    expect(hook.result.current.pathPreview).toBeNull();
    expect(hook.result.current.dragStartIndex).toBeNull();
    expect(finalizeAction).toHaveBeenCalledTimes(1);

    act(() => api().commitStrokeBuffer("#f00"));
    expect(painted()).toEqual([0, 1, 2]);
  });

  it("does not preview a freehand stroke when previews are off", () => {
    const { hook } = setup({ previewToolEffects: false });
    act(() => hook.result.current.api.beginStroke({ index: 0, position: { x: 0.5, y: 0.5 } }, "#f00", true));
    act(() => hook.result.current.api.appendStrokePoint({ x: 3.5, y: 0.5 }));
    expect(hook.result.current.pathPreview).toBeNull();
  });

  it("arms a drag stroke for line and shape tools without painting", () => {
    const { hook, painted, setDrawValue } = setup({ tool: "line" });
    act(() => hook.result.current.api.beginDragStroke(null));
    expect(hook.result.current.api.isDrawingRef.current).toBe(true);
    expect(hook.result.current.api.lastPaintedIndexRef.current).toBeNull();
    expect(setDrawValue).toHaveBeenCalledWith(null);
    expect(painted()).toEqual([]);
  });

  it("remembers the captured pointer even when capture throws", () => {
    const { hook } = setup();
    const canvas = {
      setPointerCapture: vi.fn(() => {
        throw new Error("no capture");
      }),
    } as unknown as HTMLCanvasElement;
    act(() => hook.result.current.api.capturePointer(canvas, 4));
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(4);
    expect(hook.result.current.api.activePointerIdRef.current).toBe(4);
  });

  it("traces queued pointer samples once per animation frame and updates the hover cell", () => {
    const { hook, runFrames, setHoverIndexIfChanged } = setup();
    const api = () => hook.result.current.api;
    act(() => api().beginStroke({ index: 0, position: { x: 0.5, y: 0.5 } }, "#f00", true));
    act(() =>
      api().processDrawingSamples([client(1.5, 0.5), client(2.5, 0.5)] as unknown as PointerEvent[]),
    );
    expect(hook.result.current.pathPreview).toEqual(new Set([0]));

    runFrames();
    expect(hook.result.current.pathPreview).toEqual(new Set([0, 1, 2]));
    expect(setHoverIndexIfChanged).toHaveBeenLastCalledWith(2);

    // flushPointerQueue processes immediately, without waiting for a frame.
    act(() => api().processDrawingSamples([client(3.5, 0.5)] as unknown as PointerEvent[]));
    act(() => api().flushPointerQueue());
    expect(hook.result.current.pathPreview).toEqual(new Set([0, 1, 2, 3]));
  });

  it("drops queued samples when the stroke has ended or the queue is cleared", () => {
    const { hook, runFrames, setHoverIndexIfChanged } = setup();
    const api = () => hook.result.current.api;
    act(() => api().processDrawingSamples([client(1.5, 0.5)] as unknown as PointerEvent[]));
    runFrames();
    expect(setHoverIndexIfChanged).not.toHaveBeenCalled();

    act(() => api().beginStroke({ index: 0, position: { x: 0.5, y: 0.5 } }, "#f00", true));
    act(() => api().processDrawingSamples([client(1.5, 0.5)] as unknown as PointerEvent[]));
    act(() => api().clearPointerQueue());
    runFrames();
    expect(hook.result.current.pathPreview).toEqual(new Set([0]));
  });

  it("follows window pointer moves for the captured pointer while drawing freehand", () => {
    const { hook, runFrames } = setup();
    const api = () => hook.result.current.api;
    const move = (pointerId: number, x: number) => {
      const event = new Event("pointermove", { cancelable: true }) as PointerEvent;
      Object.assign(event, { pointerId, ...client(x, 0.5) });
      act(() => {
        window.dispatchEvent(event);
      });
      return event;
    };

    move(1, 1.5);
    runFrames();
    expect(hook.result.current.pathPreview).toBeNull();

    act(() => api().beginStroke({ index: 0, position: { x: 0.5, y: 0.5 } }, "#f00", true));
    act(() => {
      api().activePointerIdRef.current = 1;
    });
    move(2, 1.5);
    runFrames();
    expect(hook.result.current.pathPreview).toEqual(new Set([0]));

    const own = move(1, 2.5);
    runFrames();
    expect(hook.result.current.pathPreview).toEqual(new Set([0, 1, 2]));
    expect(own.defaultPrevented).toBe(true);

    hook.rerender({ tool: "line", brushSize: 1, brushShape: "square", previewToolEffects: true });
    move(1, 4.5);
    runFrames();
    expect(hook.result.current.pathPreview).toEqual(new Set([0, 1, 2]));
  });
});
