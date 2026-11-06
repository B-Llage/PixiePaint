import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HISTORY_TILE_SIZE } from "../PixelPencil.constants";
import type { Layer, SelectionState } from "../PixelPencilTypes";
import { createBuffer, packColor, type DirtyRect, type PixelBuffer } from "../pixel-buffer";
import { cloneSelection } from "../pixel-operations";
import {
  tileRect,
  useEditorHistory,
  type EditorMeta,
  type HistoryStacks,
} from "./useEditorHistory";

/** Large enough that cells 64 apart fall in different history tiles. */
const SIZE = 128;
/** One full tile's before + after bytes. */
const TILE_ENTRY_BYTES = HISTORY_TILE_SIZE * HISTORY_TILE_SIZE * 4 * 2;
const RED = packColor("#f00");
const GREEN = packColor("#0f0");
const BLUE = packColor("#00f");

type EditorState = {
  layers: Layer[];
  activeLayerId: string;
  selection: SelectionState | null;
};

const makeLayer = (id: string): Layer => ({
  id,
  name: id,
  visible: true,
  pixels: createBuffer(SIZE, SIZE),
});

const makeSelection = (x = 0): SelectionState => ({
  rect: { x, y: 0, width: 1, height: 1 },
  offset: { dx: 0, dy: 0 },
  data: new Uint32Array([RED]),
  isFloating: false,
});

type SetupOptions = { maxHistory?: number; byteBudget?: number };

/**
 * Drives the hook against a small mutable editor state so tests read like the
 * component: capture the cells about to change, mutate the layer buffer in
 * place, finalize, then undo and redo.
 */
function setup({ maxHistory, byteBudget }: SetupOptions = {}) {
  const state: EditorState = {
    layers: [makeLayer("a")],
    activeLayerId: "a",
    selection: null,
  };
  const captureMeta = vi.fn(
    (): EditorMeta => ({
      layers: state.layers.map(({ id, name, visible }) => ({ id, name, visible })),
      activeLayerId: state.activeLayerId,
      selection: cloneSelection(state.selection),
    }),
  );
  // Rebuilds the layer list from metadata, keeping live buffers unless replaced.
  const applyMeta = vi.fn((meta: EditorMeta, buffers: Map<string, PixelBuffer>) => {
    state.layers = meta.layers.map((layerMeta) => {
      const pixels =
        buffers.get(layerMeta.id) ?? state.layers.find((layer) => layer.id === layerMeta.id)?.pixels;
      if (!pixels) throw new Error(`no buffer for layer ${layerMeta.id}`);
      return { ...layerMeta, pixels };
    });
    state.activeLayerId = meta.activeLayerId;
    state.selection = cloneSelection(meta.selection);
  });
  const getLayerBuffer = vi.fn(
    (layerId: string) => state.layers.find((layer) => layer.id === layerId)?.pixels ?? null,
  );
  const onPixelsRestored = vi.fn<(layerId: string, rect: DirtyRect) => void>();
  const hook = renderHook(() =>
    useEditorHistory({ captureMeta, applyMeta, getLayerBuffer, onPixelsRestored, maxHistory, byteBudget }),
  );
  const layer = (id = state.activeLayerId) => {
    const found = state.layers.find((item) => item.id === id);
    if (!found) throw new Error(`no layer ${id}`);
    return found;
  };
  const cell = (x: number, y: number, id?: string) => layer(id).pixels.data[y * SIZE + x];
  /** Captures the cell's tile, then paints it, like one step of a stroke. */
  const paint = (x: number, y: number, color: number) => {
    const target = layer();
    hook.result.current.capturePixelsBefore(target.id, { x, y, width: 1, height: 1 });
    target.pixels.data[y * SIZE + x] = color;
  };
  /** A complete one-cell action: begin, paint, finalize. */
  const stroke = (x: number, y: number, color: number) => {
    act(() => {
      hook.result.current.beginAction();
      paint(x, y, color);
      hook.result.current.markModified();
      hook.result.current.finalizeAction();
    });
  };
  const pixelEntry = (index = 0) => {
    const entry = hook.result.current.saveStacks().undo[index];
    if (entry?.kind !== "pixels") throw new Error("expected a pixel entry");
    return entry;
  };
  return {
    state,
    hook,
    cell,
    paint,
    stroke,
    pixelEntry,
    captureMeta,
    applyMeta,
    getLayerBuffer,
    onPixelsRestored,
  };
}

describe("tileRect", () => {
  it("maps tile indices to rects clipped to the buffer", () => {
    expect(tileRect(0, 128, 128)).toEqual({ x: 0, y: 0, width: 64, height: 64 });
    expect(tileRect(3, 128, 128)).toEqual({ x: 64, y: 64, width: 64, height: 64 });
    // 100 wide: two tiles per row, the second clipped to 36 cells.
    expect(tileRect(1, 100, 70)).toEqual({ x: 64, y: 0, width: 36, height: 64 });
    expect(tileRect(3, 100, 70)).toEqual({ x: 64, y: 64, width: 36, height: 6 });
  });
});

describe("useEditorHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const { hook } = setup();
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("records a stroke as tile patches and undoes and redoes it", () => {
    const { hook, cell, paint, pixelEntry, applyMeta, onPixelsRestored } = setup();

    act(() => {
      hook.result.current.beginAction();
      paint(5, 0, RED);
      paint(70, 0, GREEN);
      hook.result.current.markModified();
      hook.result.current.finalizeAction();
    });
    expect(hook.result.current.canUndo).toBe(true);

    const entry = pixelEntry();
    expect(entry.layerId).toBe("a");
    expect([...entry.tiles.keys()].sort()).toEqual([0, 1]);
    expect(entry.tiles.get(1)?.rect).toEqual({ x: 64, y: 0, width: 64, height: 64 });

    act(() => hook.result.current.undo());
    expect(cell(5, 0)).toBe(0);
    expect(cell(70, 0)).toBe(0);
    expect(onPixelsRestored).toHaveBeenCalledTimes(2);
    expect(onPixelsRestored).toHaveBeenCalledWith("a", tileRect(0, SIZE, SIZE));
    expect(onPixelsRestored).toHaveBeenCalledWith("a", tileRect(1, SIZE, SIZE));
    expect(applyMeta).toHaveBeenLastCalledWith(entry.before, new Map());
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.redo());
    expect(cell(5, 0)).toBe(RED);
    expect(cell(70, 0)).toBe(GREEN);
    expect(onPixelsRestored).toHaveBeenCalledTimes(4);
    expect(applyMeta).toHaveBeenLastCalledWith(entry.after, new Map());
    expect(hook.result.current.canUndo).toBe(true);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("records a one-shot capture without beginAction", () => {
    const { hook, cell, paint } = setup();

    act(() => {
      paint(1, 1, BLUE);
      hook.result.current.finalizeAction();
    });
    expect(hook.result.current.canUndo).toBe(true);
    act(() => hook.result.current.undo());
    expect(cell(1, 1)).toBe(0);
  });

  it("drops an action that changed nothing", () => {
    const { hook, paint } = setup();

    act(() => {
      hook.result.current.beginAction();
      hook.result.current.finalizeAction();
    });
    expect(hook.result.current.canUndo).toBe(false);

    // Painting a cell and painting it back leaves equal bytes and equal meta.
    act(() => {
      hook.result.current.beginAction();
      paint(3, 3, RED);
      paint(3, 3, 0);
      hook.result.current.markModified();
      hook.result.current.finalizeAction();
    });
    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.isActionInProgress()).toBe(false);
  });

  it("drops unchanged tiles but keeps the changed ones", () => {
    const { hook, paint, pixelEntry } = setup();

    act(() => {
      hook.result.current.beginAction();
      paint(3, 3, RED);
      paint(100, 100, GREEN);
      paint(100, 100, 0);
      hook.result.current.finalizeAction();
    });
    expect(hook.result.current.saveStacks().undo).toHaveLength(1);
    expect([...pixelEntry().tiles.keys()]).toEqual([0]);
  });

  it("keeps a meta-only change such as a new selection", () => {
    const { hook, state } = setup();

    act(() => hook.result.current.beginAction());
    state.selection = makeSelection(2);
    act(() => hook.result.current.finalizeAction());
    expect(hook.result.current.canUndo).toBe(true);

    act(() => hook.result.current.undo());
    expect(state.selection).toBeNull();
    act(() => hook.result.current.redo());
    expect(state.selection).toEqual(makeSelection(2));
  });

  it("captures before bytes once per tile even when edits overlap", () => {
    const { hook, cell, paint, pixelEntry } = setup();

    act(() => {
      hook.result.current.beginAction();
      paint(10, 10, RED);
      // Same tile again, and a rect covering the whole tile: before must stay the pre-action bytes.
      paint(10, 10, GREEN);
      hook.result.current.capturePixelsBefore("a", { x: 0, y: 0, width: 64, height: 64 });
      paint(11, 10, BLUE);
      hook.result.current.finalizeAction();
    });
    const entry = pixelEntry();
    expect(entry.tiles.size).toBe(1);
    expect(entry.tiles.get(0)?.before.every((value) => value === 0)).toBe(true);

    act(() => hook.result.current.undo());
    expect(cell(10, 10)).toBe(0);
    expect(cell(11, 10)).toBe(0);
  });

  it("captures only tiles that intersect the rect, clipped to the buffer", () => {
    const { hook, state, pixelEntry } = setup();
    const { data } = state.layers[0].pixels;

    act(() => {
      // Straddles tiles 0 and 1 and pokes above the buffer; the second rect is fully outside.
      hook.result.current.capturePixelsBefore("a", { x: 60, y: -5, width: 10, height: 10 });
      hook.result.current.capturePixelsBefore("a", { x: 500, y: 500, width: 3, height: 3 });
      data[0 * SIZE + 60] = RED;
      data[0 * SIZE + 69] = RED;
      // Tile 3 was never captured, so this change is not part of the entry.
      data[100 * SIZE + 100] = RED;
      hook.result.current.finalizeAction();
    });
    expect([...pixelEntry().tiles.keys()].sort()).toEqual([0, 1]);
  });

  it("records structure changes with replaced buffers and restores them on undo", () => {
    const { hook, state, cell, applyMeta } = setup();
    state.layers.push(makeLayer("b"));
    state.layers[1].pixels.data[0] = RED;
    state.activeLayerId = "b";

    // Delete layer b: the apply callback returns the buffer it removed.
    act(() =>
      hook.result.current.recordStructureChange(() => {
        const removed = state.layers.find((layer) => layer.id === "b");
        state.layers = state.layers.filter((layer) => layer.id !== "b");
        state.activeLayerId = "a";
        return new Map(removed ? [["b", removed.pixels]] : []);
      }),
    );
    expect(state.layers.map((layer) => layer.id)).toEqual(["a"]);
    expect(hook.result.current.canUndo).toBe(true);

    const entry = hook.result.current.saveStacks().undo[0];
    if (entry.kind !== "structure") throw new Error("expected a structure entry");
    expect([...entry.buffersBefore.keys()]).toEqual(["b"]);
    expect(entry.buffersAfter.size).toBe(0);

    act(() => hook.result.current.undo());
    expect(state.layers.map((layer) => layer.id)).toEqual(["a", "b"]);
    expect(state.activeLayerId).toBe("b");
    expect(cell(0, 0, "b")).toBe(RED);
    const [undoMeta, undoBuffers] = applyMeta.mock.lastCall ?? [];
    expect(undoMeta).toEqual(entry.before);
    expect(undoBuffers?.get("b")?.data[0]).toBe(RED);

    // The restored buffer is a copy: painting into it does not corrupt the entry.
    state.layers[1].pixels.data[0] = GREEN;

    act(() => hook.result.current.redo());
    expect(state.layers.map((layer) => layer.id)).toEqual(["a"]);
    expect(state.activeLayerId).toBe("a");

    act(() => hook.result.current.undo());
    expect(cell(0, 0, "b")).toBe(RED);
  });

  it("clones the current buffers of replaced layers as the redo state", () => {
    const { hook, state, cell } = setup();
    state.layers[0].pixels.data[0] = RED;

    // Reset layer a to a fresh buffer.
    act(() =>
      hook.result.current.recordStructureChange(() => {
        const old = state.layers[0].pixels;
        state.layers[0] = { ...state.layers[0], pixels: createBuffer(SIZE, SIZE) };
        return new Map([["a", old]]);
      }),
    );
    // The editor keeps painting into the live buffer; the entry's after copy must not change.
    state.layers[0].pixels.data[1] = GREEN;

    act(() => hook.result.current.undo());
    expect(cell(0, 0)).toBe(RED);
    expect(cell(1, 0)).toBe(0);
    act(() => hook.result.current.redo());
    expect(cell(0, 0)).toBe(0);
    expect(cell(1, 0)).toBe(0);
  });

  it("ends a pixel action in progress without recording it when a structure change lands", () => {
    const { hook, state, paint } = setup();

    act(() => {
      hook.result.current.beginAction();
      paint(0, 0, RED);
      hook.result.current.recordStructureChange(() => {
        state.layers[0] = { ...state.layers[0], name: "renamed" };
      });
    });
    expect(hook.result.current.isActionInProgress()).toBe(false);
    expect(hook.result.current.saveStacks().undo.map((entry) => entry.kind)).toEqual(["structure"]);

    act(() => hook.result.current.undo());
    expect(state.layers[0].name).toBe("a");
  });

  it("evicts the oldest entries past the byte budget and keeps the rest undoable", () => {
    const { hook, cell, stroke } = setup({ byteBudget: 3 * TILE_ENTRY_BYTES });

    stroke(0, 0, RED);
    stroke(70, 0, GREEN);
    stroke(0, 70, BLUE);
    stroke(70, 70, RED);
    expect(hook.result.current.saveStacks().undo).toHaveLength(3);

    act(() => hook.result.current.undo());
    act(() => hook.result.current.undo());
    act(() => hook.result.current.undo());
    // Back to the state after action 1: its own patch was evicted.
    expect(cell(0, 0)).toBe(RED);
    expect(cell(70, 0)).toBe(0);
    expect(cell(0, 70)).toBe(0);
    expect(cell(70, 70)).toBe(0);
    expect(hook.result.current.canUndo).toBe(false);

    act(() => hook.result.current.redo());
    act(() => hook.result.current.redo());
    act(() => hook.result.current.redo());
    expect(cell(70, 70)).toBe(RED);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("keeps a single entry larger than the byte budget", () => {
    const { hook, stroke } = setup({ byteBudget: 1 });

    stroke(0, 0, RED);
    stroke(70, 0, GREEN);
    expect(hook.result.current.saveStacks().undo).toHaveLength(1);
    expect(hook.result.current.canUndo).toBe(true);
  });

  it("caps entries at maxHistory", () => {
    const { hook, cell, stroke } = setup({ maxHistory: 3 });

    for (let step = 1; step <= 5; step += 1) {
      stroke(0, 0, step);
    }
    expect(hook.result.current.saveStacks().undo).toHaveLength(3);
    for (let step = 0; step < 5; step += 1) {
      act(() => hook.result.current.undo());
    }
    expect(cell(0, 0)).toBe(2);
    expect(hook.result.current.canUndo).toBe(false);

    for (let step = 0; step < 5; step += 1) {
      act(() => hook.result.current.redo());
    }
    expect(cell(0, 0)).toBe(5);
    expect(hook.result.current.canRedo).toBe(false);
  });

  it("clears the redo stack when a new action is recorded", () => {
    const { hook, cell, stroke } = setup();

    stroke(0, 0, RED);
    act(() => hook.result.current.undo());
    expect(hook.result.current.canRedo).toBe(true);

    stroke(70, 0, GREEN);
    expect(hook.result.current.canRedo).toBe(false);
    act(() => hook.result.current.redo());
    expect(cell(0, 0)).toBe(0);
    expect(cell(70, 0)).toBe(GREEN);
  });

  it("ignores undo while an action is in progress", () => {
    const { hook, cell, paint, stroke, applyMeta } = setup();

    stroke(0, 0, RED);
    act(() => {
      hook.result.current.beginAction();
      paint(70, 0, GREEN);
    });
    expect(hook.result.current.isActionInProgress()).toBe(true);
    act(() => hook.result.current.undo());
    act(() => hook.result.current.redo());
    expect(applyMeta).not.toHaveBeenCalled();
    expect(cell(0, 0)).toBe(RED);
    expect(cell(70, 0)).toBe(GREEN);

    act(() => hook.result.current.finalizeAction());
    act(() => hook.result.current.undo());
    expect(cell(70, 0)).toBe(0);
    expect(cell(0, 0)).toBe(RED);
  });

  it("does not recapture before meta when beginAction repeats mid-action", () => {
    const { hook, captureMeta } = setup();

    act(() => hook.result.current.beginAction());
    act(() => hook.result.current.beginAction());
    expect(captureMeta).toHaveBeenCalledTimes(1);
  });

  it("skips tile writes for a layer that no longer exists", () => {
    const { hook, cell, stroke, getLayerBuffer, onPixelsRestored, applyMeta } = setup();

    stroke(0, 0, RED);
    getLayerBuffer.mockReturnValueOnce(null);
    act(() => hook.result.current.undo());
    expect(onPixelsRestored).not.toHaveBeenCalled();
    expect(cell(0, 0)).toBe(RED);
    // The metadata side of the entry still applies, and the entry moves to redo.
    expect(applyMeta).toHaveBeenCalledTimes(1);
    expect(hook.result.current.canRedo).toBe(true);
  });

  it("saveStacks and restoreStacks round trip", () => {
    const { hook, cell, paint, stroke } = setup();

    stroke(0, 0, RED);
    stroke(70, 0, GREEN);
    act(() => hook.result.current.undo());
    let saved: HistoryStacks = { undo: [], redo: [] };
    act(() => {
      saved = hook.result.current.saveStacks();
    });
    expect(saved.undo).toHaveLength(1);
    expect(saved.redo).toHaveLength(1);

    // A cancelled move drag: changes are recorded, rolled back, then the saved stacks return.
    act(() => {
      hook.result.current.beginAction();
      paint(5, 5, BLUE);
    });
    act(() => hook.result.current.finalizeAction());
    expect(hook.result.current.canRedo).toBe(false);
    act(() => hook.result.current.undo());
    act(() => hook.result.current.beginAction());
    act(() => hook.result.current.restoreStacks(saved));
    expect(hook.result.current.isActionInProgress()).toBe(false);
    expect(hook.result.current.canUndo).toBe(true);
    expect(hook.result.current.canRedo).toBe(true);

    act(() => hook.result.current.redo());
    expect(cell(70, 0)).toBe(GREEN);
    act(() => hook.result.current.undo());
    act(() => hook.result.current.undo());
    expect(cell(0, 0)).toBe(0);
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("clears both stacks and ends the action in progress", () => {
    const { hook, paint, stroke, applyMeta } = setup();

    stroke(0, 0, RED);
    stroke(70, 0, GREEN);
    act(() => hook.result.current.undo());
    act(() => {
      hook.result.current.beginAction();
      paint(1, 1, BLUE);
    });
    act(() => hook.result.current.clear());

    expect(hook.result.current.canUndo).toBe(false);
    expect(hook.result.current.canRedo).toBe(false);
    expect(hook.result.current.isActionInProgress()).toBe(false);
    applyMeta.mockClear();
    act(() => hook.result.current.undo());
    act(() => hook.result.current.redo());
    expect(applyMeta).not.toHaveBeenCalled();

    // finalizeAction after clear is a no-op: the cleared action is not recorded.
    act(() => hook.result.current.finalizeAction());
    expect(hook.result.current.canUndo).toBe(false);
  });

  it("returns stable functions across renders", () => {
    const { hook, stroke } = setup();
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(first);
    stroke(0, 0, RED);
    expect(hook.result.current.undo).toBe(first.undo);
    expect(hook.result.current.capturePixelsBefore).toBe(first.capturePixelsBefore);
  });
});
