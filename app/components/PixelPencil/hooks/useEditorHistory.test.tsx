import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Layer, PixelValue, SelectionState } from "../PixelPencilTypes";
import { cloneLayers, cloneSelection } from "../pixel-operations";
import { useEditorHistory, type LayerSnapshot } from "./useEditorHistory";

const TOTAL_CELLS = 4;

type EditorState = {
  layers: Layer[];
  activeLayerId: string;
  selection: SelectionState | null;
};

const makeLayer = (id: string, pixels: PixelValue[] = [null, null, null, null]): Layer => ({
  id,
  name: id,
  pixels,
  visible: true,
});

const makeSelection = (x = 0): SelectionState => ({
  rect: { x, y: 0, width: 1, height: 1 },
  offset: { dx: 0, dy: 0 },
  pixels: [{ relX: 0, relY: 0, color: "#fff" }],
  isFloating: false,
});

/**
 * Drives the hook against a tiny mutable editor state so tests read like the
 * component: mutate state, record history, then undo and redo it.
 */
function setup(maxHistory?: number) {
  const state: EditorState = {
    layers: [makeLayer("a")],
    activeLayerId: "a",
    selection: null,
  };
  const captureSnapshot = vi.fn(
    (): LayerSnapshot => ({
      layers: cloneLayers(state.layers, TOTAL_CELLS),
      activeLayerId: state.activeLayerId,
      selection: cloneSelection(state.selection),
    }),
  );
  const applySnapshot = vi.fn((snapshot: LayerSnapshot) => {
    state.layers = cloneLayers(snapshot.layers, TOTAL_CELLS);
    state.activeLayerId = snapshot.activeLayerId;
    state.selection = cloneSelection(snapshot.selection);
  });
  const hook = renderHook(() => useEditorHistory({ captureSnapshot, applySnapshot, maxHistory }));
  const paint = (index: number, color: PixelValue) => {
    const layer = state.layers.find((item) => item.id === state.activeLayerId);
    if (!layer) throw new Error(`no active layer ${state.activeLayerId}`);
    layer.pixels[index] = color;
  };
  const activePixels = () =>
    state.layers.find((item) => item.id === state.activeLayerId)?.pixels ?? [];
  return { state, hook, paint, activePixels, captureSnapshot, applySnapshot };
}

describe("useEditorHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const { hook } = setup();
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("records a snapshot and restores it on undo, then reapplies on redo", () => {
    const { hook, paint, activePixels } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    expect(hook.result.current.canUndo).toBe(true);

    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual([null, null, null, null]);
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.redo());
    expect(activePixels()).toEqual(["#f00", null, null, null]);
    expect(hook.result.current.canUndo).toBe(true);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("round-trips active layer and selection through undo and redo", () => {
    const { hook, state } = setup();
    state.layers.push(makeLayer("b"));
    state.selection = makeSelection(1);

    act(() => hook.result.current.commitSnapshot());
    state.activeLayerId = "b";
    state.selection = null;

    act(() => hook.result.current.undo());
    expect(state.activeLayerId).toBe("a");
    expect(state.selection).toEqual(makeSelection(1));

    act(() => hook.result.current.redo());
    expect(state.activeLayerId).toBe("b");
    expect(state.selection).toBeNull();
  });

  it("does not push a snapshot equal to the top of the undo stack", () => {
    const { hook, paint, activePixels } = setup();

    act(() => hook.result.current.recordSnapshot());
    act(() => hook.result.current.recordSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.recordSnapshot());
    act(() => hook.result.current.recordSnapshot());
    paint(1, "#0f0");

    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual(["#f00", null, null, null]);
    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual([null, null, null, null]);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("drops the oldest entries past the history cap on both stacks", () => {
    const cap = 3;
    const { hook, paint, activePixels } = setup(cap);

    for (let step = 0; step < 5; step += 1) {
      act(() => hook.result.current.commitSnapshot());
      paint(0, `#${step}`);
    }
    // Only the last `cap` states are reachable: #4 (current) -> #3 -> #2 -> #1.
    for (let step = 0; step < 5; step += 1) {
      act(() => hook.result.current.undo());
    }
    expect(activePixels()).toEqual(["#1", null, null, null]);
    expect(hook.result.current.canUndo).toBe(false);

    // Redo stack holds #2, #3, #4; it is capped the same way, so all three return.
    for (let step = 0; step < 5; step += 1) {
      act(() => hook.result.current.redo());
    }
    expect(activePixels()).toEqual(["#4", null, null, null]);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("clears the redo stack when a new snapshot is recorded", () => {
    const { hook, paint, activePixels } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.undo());
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.recordSnapshot());
    paint(1, "#0f0");
    expect(hook.result.current.canRedo).toBe(false);

    act(() => hook.result.current.redo());
    expect(activePixels()).toEqual([null, "#0f0", null, null]);
  });

  it("clears the redo stack when an action begins", () => {
    const { hook, paint } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.undo());
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.beginAction());
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("ignores undo and redo while an action is in progress", () => {
    const { hook, paint, activePixels, applySnapshot } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.undo());
    act(() => hook.result.current.redo());
    expect(applySnapshot).toHaveBeenCalledTimes(2);

    act(() => hook.result.current.beginAction());
    paint(1, "#0f0");
    act(() => hook.result.current.markModified());
    act(() => hook.result.current.undo());
    act(() => hook.result.current.redo());
    expect(applySnapshot).toHaveBeenCalledTimes(2);
    expect(activePixels()).toEqual(["#f00", "#0f0", null, null]);

    act(() => hook.result.current.finalizeAction());
    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual(["#f00", null, null, null]);
  });

  it("does not record a second snapshot when beginAction repeats mid-action", () => {
    const { hook, paint, captureSnapshot } = setup();

    act(() => hook.result.current.beginAction());
    paint(0, "#f00");
    act(() => hook.result.current.beginAction());
    expect(captureSnapshot).toHaveBeenCalledTimes(1);
  });

  it("drops an action's snapshot when finalizing without changes", () => {
    const { hook, paint, activePixels } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.beginAction());
    act(() => hook.result.current.finalizeAction());

    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual([null, null, null, null]);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("keeps an action's snapshot when finalizing after changes", () => {
    const { hook, paint, activePixels } = setup();

    act(() => hook.result.current.beginAction());
    paint(0, "#f00");
    act(() => hook.result.current.finalizeAction());
    expect(hook.result.current.canUndo).toBe(true);

    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual([null, null, null, null]);
  });

  it("begins an action from an explicit snapshot without deduplication", () => {
    const { hook, state, paint, activePixels } = setup();
    const explicitSnapshot = (): LayerSnapshot => ({
      layers: cloneLayers(state.layers, TOTAL_CELLS),
      activeLayerId: "a",
      selection: makeSelection(2),
    });

    act(() => hook.result.current.recordSnapshot());
    act(() => hook.result.current.beginActionWithSnapshot(explicitSnapshot()));
    paint(0, "#f00");
    // Same pixels as the entry below it would be deduped by recordSnapshot; here it is kept.
    act(() => hook.result.current.beginActionWithSnapshot(explicitSnapshot()));
    act(() => hook.result.current.beginActionWithSnapshot(explicitSnapshot()));
    act(() => hook.result.current.finalizeAction());

    // Two identical entries sit on the stack, so the painted state restores twice.
    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual(["#f00", null, null, null]);
    expect(state.selection).toEqual(makeSelection(2));
    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual(["#f00", null, null, null]);
    expect(state.selection).toEqual(makeSelection(2));
    act(() => hook.result.current.undo());
    expect(activePixels()).toEqual([null, null, null, null]);
    expect(state.selection).toEqual(makeSelection(2));
    act(() => hook.result.current.undo());
    expect(state.selection).toBeNull();
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("restores saved stacks and ends the action in progress", () => {
    const { hook, paint, activePixels } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.undo());
    let saved = { undo: [] as LayerSnapshot[], redo: [] as LayerSnapshot[] };
    act(() => {
      saved = hook.result.current.saveStacks();
    });
    expect(saved.undo).toHaveLength(0);
    expect(saved.redo).toHaveLength(1);

    act(() => hook.result.current.beginAction());
    paint(1, "#0f0");
    expect(hook.result.current.canRedo).toBe(false);

    paint(1, null);
    act(() => hook.result.current.restoreStacks(saved));
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.redo());
    expect(activePixels()).toEqual(["#f00", null, null, null]);
  });

  it("clears both stacks and ends the action in progress", () => {
    const { hook, paint, applySnapshot } = setup();

    act(() => hook.result.current.commitSnapshot());
    paint(0, "#f00");
    act(() => hook.result.current.undo());
    act(() => hook.result.current.beginAction());
    act(() => hook.result.current.clear());

    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
    act(() => hook.result.current.undo());
    act(() => hook.result.current.redo());
    expect(applySnapshot).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.commitSnapshot());
    expect(hook.result.current.canUndo).toBe(true);
  });
});
