import { useCallback, useMemo, useRef, useState } from "react";

import { HISTORY_BYTE_BUDGET, HISTORY_TILE_SIZE, MAX_HISTORY } from "../PixelPencil.constants";
import type { SelectionState } from "../PixelPencilTypes";
import {
  cloneBuffer,
  extractRect,
  intersectRect,
  writeRect,
  type DirtyRect,
  type PixelBuffer,
} from "../pixel-buffer";
import { areSelectionsEqual, cloneSelection } from "../pixel-operations";

/** A layer's identity and display state, without its pixels. */
export type LayerMeta = { id: string; name: string; visible: boolean };

/** Everything undo and redo restore apart from pixels: the layer list, the active layer, and the selection. */
export type EditorMeta = {
  layers: LayerMeta[];
  activeLayerId: string;
  selection: SelectionState | null;
};

/** One history tile's cells before and after an action, row-major over `rect`. */
export type TilePatch = { rect: DirtyRect; before: Uint32Array; after: Uint32Array };

/**
 * A pixel action on one layer (a stroke, a fill, a move): the tiles it changed, keyed by
 * tile index, plus the metadata on either side so selection changes undo with it.
 */
export type PixelEntry = {
  kind: "pixels";
  layerId: string;
  tiles: Map<number, TilePatch>;
  before: EditorMeta;
  after: EditorMeta;
};

/**
 * A change to the layer list (add, delete, reorder, rename, reset). Buffers are kept only for
 * layers whose pixel buffer the operation replaced or removed; other layers keep their live buffers.
 */
export type StructureEntry = {
  kind: "structure";
  before: EditorMeta;
  after: EditorMeta;
  buffersBefore: Map<string, PixelBuffer>;
  buffersAfter: Map<string, PixelBuffer>;
};

export type HistoryEntry = PixelEntry | StructureEntry;

/** A saved copy of both stacks, used to roll back a cancelled move drag. */
export type HistoryStacks = {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
};

export type EditorHistoryOptions = {
  /** Returns the editor's current metadata. The hook copies it, so the result may share state. */
  captureMeta: () => EditorMeta;
  /**
   * Restores metadata into component state. `buffers` holds replacement pixel buffers by layer id
   * (empty for pixel entries); every other layer listed in `meta` keeps its current buffer. A layer
   * listed in `meta` with neither a live buffer nor an entry in `buffers` (redo of an added layer)
   * gets a blank buffer of the current grid size; later pixel entries restore its contents. The
   * buffers are fresh copies the editor may install and mutate.
   */
  applyMeta: (meta: EditorMeta, buffers: Map<string, PixelBuffer>) => void;
  /** Returns the live, in-place-mutated buffer of a layer, or `null` if the layer is gone. */
  getLayerBuffer: (layerId: string) => PixelBuffer | null;
  /** Called after undo or redo writes a tile back into a layer, so the composite can redraw it. */
  onPixelsRestored: (layerId: string, rect: DirtyRect) => void;
  /** Maximum entries kept on each stack. */
  maxHistory?: number;
  /** Bytes of pixel data the undo stack may hold before the oldest entries are dropped. */
  byteBudget?: number;
};

export type EditorHistory = {
  canUndo: boolean;
  canRedo: boolean;
  /** Starts a multi-step action by capturing the current metadata. No-op while one is in progress. */
  beginAction: () => void;
  /**
   * Call before changing cells inside `rect` on `layerId`. Copies each intersecting tile the
   * action has not captured yet, so the cost is bounded by the touched area. Starts an action if
   * none is open, so one-shot edits only need this and `finalizeAction`. An action records one
   * layer: captures for any other layer are ignored.
   */
  capturePixelsBefore: (layerId: string, rect: DirtyRect) => void;
  /** Flags that the action in progress changed pixels. Informational: `finalizeAction` compares bytes. */
  markModified: () => void;
  /**
   * Ends the action in progress: copies the `after` bytes of exactly the captured tiles, drops
   * tiles that did not change, and drops the whole entry when no tile changed and the metadata is
   * equal. Otherwise pushes it, clears redo, and enforces the entry cap and byte budget.
   * No-op without an action.
   */
  finalizeAction: () => void;
  /**
   * Records a one-shot change to the layer list. `apply` performs it and returns the buffers it
   * replaced or removed, keyed by layer id (ownership passes to the history). Those layers'
   * current buffers, if they still exist, are cloned as the redo state. Ends any pixel action in
   * progress without recording it.
   */
  recordStructureChange: (apply: () => Map<string, PixelBuffer> | void) => void;
  isActionInProgress: () => boolean;
  /** Copies both stacks so they can be restored after a cancelled action. */
  saveStacks: () => HistoryStacks;
  /** Replaces both stacks with saved copies and ends any action in progress. */
  restoreStacks: (stacks: HistoryStacks) => void;
  /** Empties both stacks and ends any action in progress. */
  clear: () => void;
  /** Steps back one entry. Ignored while a pixel action is in progress. */
  undo: () => void;
  /** Steps forward one entry. Ignored while a pixel action is in progress. */
  redo: () => void;
};

/** The pixel action being built between `beginAction` / first capture and `finalizeAction`. */
type PendingAction = {
  before: EditorMeta;
  /** Set by the first capture; later captures for other layers are ignored. */
  layerId: string | null;
  tiles: Map<number, { rect: DirtyRect; before: Uint32Array }>;
};

/** The rect of tile `tileIndex` in a `width` x `height` buffer, clipped to the buffer. */
export function tileRect(tileIndex: number, width: number, height: number): DirtyRect {
  const tilesPerRow = Math.ceil(width / HISTORY_TILE_SIZE);
  const x = (tileIndex % tilesPerRow) * HISTORY_TILE_SIZE;
  const y = Math.floor(tileIndex / tilesPerRow) * HISTORY_TILE_SIZE;
  return {
    x,
    y,
    width: Math.min(HISTORY_TILE_SIZE, width - x),
    height: Math.min(HISTORY_TILE_SIZE, height - y),
  };
}

const copyMeta = (meta: EditorMeta): EditorMeta => ({
  layers: meta.layers.map(({ id, name, visible }) => ({ id, name, visible })),
  activeLayerId: meta.activeLayerId,
  selection: cloneSelection(meta.selection),
});

const areMetasEqual = (a: EditorMeta, b: EditorMeta) =>
  a.activeLayerId === b.activeLayerId &&
  a.layers.length === b.layers.length &&
  a.layers.every(
    (layer, index) =>
      layer.id === b.layers[index].id &&
      layer.name === b.layers[index].name &&
      layer.visible === b.layers[index].visible,
  ) &&
  areSelectionsEqual(a.selection, b.selection);

const areBytesEqual = (a: Uint32Array, b: Uint32Array) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

const sumBufferBytes = (buffers: Map<string, PixelBuffer>) => {
  let bytes = 0;
  for (const buffer of buffers.values()) bytes += buffer.data.byteLength;
  return bytes;
};

/**
 * Selection bytes an entry's metadata holds. An unchanged selection is shared between `before`
 * and `after` (see `shareUnchangedSelection`), so it is counted once.
 */
const selectionBytes = (before: EditorMeta, after: EditorMeta) => {
  const beforeBytes = before.selection?.data.byteLength ?? 0;
  if (after.selection === before.selection) return beforeBytes;
  return beforeBytes + (after.selection?.data.byteLength ?? 0);
};

/**
 * Bytes an entry holds: tile before + after, or the replaced buffers on both sides, plus the
 * selection data in its metadata.
 */
export const entryBytes = (entry: HistoryEntry) => {
  let bytes = selectionBytes(entry.before, entry.after);
  if (entry.kind === "structure") {
    return bytes + sumBufferBytes(entry.buffersBefore) + sumBufferBytes(entry.buffersAfter);
  }
  for (const tile of entry.tiles.values()) bytes += tile.before.byteLength + tile.after.byteLength;
  return bytes;
};

/**
 * Returns `after` with its selection replaced by `before`'s when the two are equal, so an entry
 * stores one copy. Entries are never mutated, so sharing the object is safe.
 */
const shareUnchangedSelection = (before: EditorMeta, after: EditorMeta): EditorMeta =>
  areSelectionsEqual(before.selection, after.selection) ? { ...after, selection: before.selection } : after;

const sumEntryBytes = (stack: HistoryEntry[]) => stack.reduce((total, entry) => total + entryBytes(entry), 0);

const cloneBuffers = (buffers: Map<string, PixelBuffer>) => {
  const copies = new Map<string, PixelBuffer>();
  for (const [id, buffer] of buffers) copies.set(id, cloneBuffer(buffer));
  return copies;
};

/**
 * Undo/redo history for the editor, stored as patches.
 *
 * Pixel actions keep the before and after bytes of each 64x64 tile they touched, so recording,
 * undoing, and redoing cost the touched area rather than the canvas. Layer buffers are mutated in
 * place: undo and redo write tiles into the buffers `getLayerBuffer` returns and report each one
 * through `onPixelsRestored`. Layer-list changes keep whole buffers only for the layers whose
 * buffers they replaced. The undo stack is capped at `maxHistory` entries and `byteBudget` bytes.
 *
 * The hook owns only the stacks and the in-progress action. The returned functions change
 * identity when the option callbacks do, so callers list them as dependencies like any other
 * callback.
 */
export function useEditorHistory({
  captureMeta,
  applyMeta,
  getLayerBuffer,
  onPixelsRestored,
  maxHistory = MAX_HISTORY,
  byteBudget = HISTORY_BYTE_BUDGET,
}: EditorHistoryOptions): EditorHistory {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  /** Running `entryBytes` total of the undo stack. */
  const undoBytesRef = useRef(0);
  const pendingRef = useRef<PendingAction | null>(null);
  const actionModifiedRef = useRef(false);

  const updateHistoryState = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const endAction = useCallback(() => {
    pendingRef.current = null;
    actionModifiedRef.current = false;
  }, []);

  /** Pushes onto the undo stack, dropping from the bottom past the entry cap. */
  const pushUndo = useCallback(
    (entry: HistoryEntry) => {
      const undoStack = undoStackRef.current;
      if (undoStack.length >= maxHistory) {
        const dropped = undoStack.shift();
        if (dropped) undoBytesRef.current -= entryBytes(dropped);
      }
      undoStack.push(entry);
      undoBytesRef.current += entryBytes(entry);
    },
    [maxHistory],
  );

  const pushRedo = useCallback(
    (entry: HistoryEntry) => {
      const redoStack = redoStackRef.current;
      if (redoStack.length >= maxHistory) redoStack.shift();
      redoStack.push(entry);
    },
    [maxHistory],
  );

  /** Records a new entry: pushes it, clears redo, and evicts the oldest entries past the byte budget. */
  const pushNewEntry = useCallback(
    (entry: HistoryEntry) => {
      pushUndo(entry);
      redoStackRef.current = [];
      const undoStack = undoStackRef.current;
      while (undoBytesRef.current > byteBudget && undoStack.length > 1) {
        const dropped = undoStack.shift();
        if (dropped) undoBytesRef.current -= entryBytes(dropped);
      }
      updateHistoryState();
    },
    [byteBudget, pushUndo, updateHistoryState],
  );

  const beginAction = useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = { before: copyMeta(captureMeta()), layerId: null, tiles: new Map() };
    actionModifiedRef.current = false;
  }, [captureMeta]);

  const capturePixelsBefore = useCallback(
    (layerId: string, rect: DirtyRect) => {
      beginAction();
      const pending = pendingRef.current;
      if (!pending) return;
      if (pending.layerId === null) pending.layerId = layerId;
      if (pending.layerId !== layerId) return;
      const buffer = getLayerBuffer(layerId);
      if (!buffer) return;
      const clipped = intersectRect(rect, { x: 0, y: 0, width: buffer.width, height: buffer.height });
      if (!clipped) return;
      const tilesPerRow = Math.ceil(buffer.width / HISTORY_TILE_SIZE);
      const firstColumn = Math.floor(clipped.x / HISTORY_TILE_SIZE);
      const lastColumn = Math.floor((clipped.x + clipped.width - 1) / HISTORY_TILE_SIZE);
      const firstRow = Math.floor(clipped.y / HISTORY_TILE_SIZE);
      const lastRow = Math.floor((clipped.y + clipped.height - 1) / HISTORY_TILE_SIZE);
      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const tileIndex = row * tilesPerRow + column;
          if (pending.tiles.has(tileIndex)) continue;
          const tile = tileRect(tileIndex, buffer.width, buffer.height);
          pending.tiles.set(tileIndex, { rect: tile, before: extractRect(buffer, tile) });
        }
      }
    },
    [beginAction, getLayerBuffer],
  );

  const markModified = useCallback(() => {
    actionModifiedRef.current = true;
  }, []);

  const finalizeAction = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    endAction();
    const after = shareUnchangedSelection(pending.before, copyMeta(captureMeta()));
    const tiles = new Map<number, TilePatch>();
    const buffer = pending.layerId === null ? null : getLayerBuffer(pending.layerId);
    if (buffer) {
      for (const [tileIndex, { rect, before }] of pending.tiles) {
        const tileAfter = extractRect(buffer, rect);
        if (!areBytesEqual(before, tileAfter)) tiles.set(tileIndex, { rect, before, after: tileAfter });
      }
    }
    if (tiles.size === 0 && areMetasEqual(pending.before, after)) return;
    pushNewEntry({
      kind: "pixels",
      layerId: pending.layerId ?? pending.before.activeLayerId,
      tiles,
      before: pending.before,
      after,
    });
  }, [captureMeta, endAction, getLayerBuffer, pushNewEntry]);

  const recordStructureChange = useCallback(
    (apply: () => Map<string, PixelBuffer> | void) => {
      endAction();
      const before = copyMeta(captureMeta());
      const buffersBefore = apply() ?? new Map<string, PixelBuffer>();
      const buffersAfter = new Map<string, PixelBuffer>();
      for (const layerId of buffersBefore.keys()) {
        const current = getLayerBuffer(layerId);
        if (current) buffersAfter.set(layerId, cloneBuffer(current));
      }
      const after = shareUnchangedSelection(before, copyMeta(captureMeta()));
      pushNewEntry({ kind: "structure", before, after, buffersBefore, buffersAfter });
    },
    [captureMeta, endAction, getLayerBuffer, pushNewEntry],
  );

  const isActionInProgress = useCallback(() => pendingRef.current !== null, []);

  const saveStacks = useCallback(
    (): HistoryStacks => ({
      undo: undoStackRef.current.slice(),
      redo: redoStackRef.current.slice(),
    }),
    [],
  );

  const restoreStacks = useCallback(
    (stacks: HistoryStacks) => {
      undoStackRef.current = stacks.undo.slice();
      redoStackRef.current = stacks.redo.slice();
      undoBytesRef.current = sumEntryBytes(undoStackRef.current);
      endAction();
      updateHistoryState();
    },
    [endAction, updateHistoryState],
  );

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoBytesRef.current = 0;
    endAction();
    updateHistoryState();
  }, [endAction, updateHistoryState]);

  /** Applies one side of an entry: tiles then metadata for pixels, metadata and buffers for structure. */
  const applyEntry = useCallback(
    (entry: HistoryEntry, side: "before" | "after") => {
      if (entry.kind === "structure") {
        const buffers = side === "before" ? entry.buffersBefore : entry.buffersAfter;
        applyMeta(entry[side], cloneBuffers(buffers));
        return;
      }
      const buffer = getLayerBuffer(entry.layerId);
      if (buffer) {
        for (const tile of entry.tiles.values()) {
          writeRect(buffer, tile.rect, tile[side]);
          onPixelsRestored(entry.layerId, tile.rect);
        }
      }
      applyMeta(entry[side], new Map());
    },
    [applyMeta, getLayerBuffer, onPixelsRestored],
  );

  const undo = useCallback(() => {
    if (pendingRef.current) return;
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    undoBytesRef.current -= entryBytes(entry);
    applyEntry(entry, "before");
    pushRedo(entry);
    updateHistoryState();
  }, [applyEntry, pushRedo, updateHistoryState]);

  const redo = useCallback(() => {
    if (pendingRef.current) return;
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    applyEntry(entry, "after");
    pushUndo(entry);
    updateHistoryState();
  }, [applyEntry, pushUndo, updateHistoryState]);

  return useMemo(
    () => ({
      canUndo,
      canRedo,
      beginAction,
      capturePixelsBefore,
      markModified,
      finalizeAction,
      recordStructureChange,
      isActionInProgress,
      saveStacks,
      restoreStacks,
      clear,
      undo,
      redo,
    }),
    [
      beginAction,
      canRedo,
      canUndo,
      capturePixelsBefore,
      clear,
      finalizeAction,
      isActionInProgress,
      markModified,
      recordStructureChange,
      redo,
      restoreStacks,
      saveStacks,
      undo,
    ],
  );
}
