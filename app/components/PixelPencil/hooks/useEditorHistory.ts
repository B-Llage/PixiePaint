import { useCallback, useMemo, useRef, useState } from "react";

import { MAX_HISTORY } from "../PixelPencil.constants";
import type { Layer, SelectionState } from "../PixelPencilTypes";
import { areLayersEqual, areSelectionsEqual } from "../pixel-operations";

/** What undo and redo restore: the layer stack, the active layer, and the selection. */
export type LayerSnapshot = {
  layers: Layer[];
  activeLayerId: string;
  selection: SelectionState | null;
};

/** A saved copy of both stacks, used to roll back a cancelled move drag. */
export type HistoryStacks = {
  undo: LayerSnapshot[];
  redo: LayerSnapshot[];
};

export type EditorHistoryOptions = {
  /** Returns a fresh snapshot of the editor's current state. Must clone, since snapshots are kept. */
  captureSnapshot: () => LayerSnapshot;
  /** Restores a snapshot into component state. */
  applySnapshot: (snapshot: LayerSnapshot) => void;
  /** Maximum entries kept on each stack. */
  maxHistory?: number;
};

export type EditorHistory = {
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Pushes the current snapshot onto the undo stack unless it matches the top
   * entry, then clears the redo stack. Does not touch the in-progress action.
   */
  recordSnapshot: () => void;
  /** `recordSnapshot` for a one-shot change (layer add, delete, reorder, clear); also ends any action in progress. */
  commitSnapshot: () => void;
  /** Starts a multi-step action by recording the current snapshot. No-op while one is in progress. */
  beginAction: () => void;
  /**
   * Starts an action from an explicit snapshot without deduplication or the
   * in-progress guard. The move drag uses it to record the dragged layer's
   * pre-drag state after the first real movement.
   */
  beginActionWithSnapshot: (snapshot: LayerSnapshot) => void;
  /** Ends the action in progress; drops its snapshot if nothing changed since. */
  finalizeAction: () => void;
  /** Flags that the action in progress changed pixels. */
  markModified: () => void;
  /** Copies both stacks so they can be restored after a cancelled action. */
  saveStacks: () => HistoryStacks;
  /** Replaces both stacks with saved copies and ends any action in progress. */
  restoreStacks: (stacks: HistoryStacks) => void;
  /** Empties both stacks and ends any action in progress. */
  clear: () => void;
  undo: () => void;
  redo: () => void;
};

const areSnapshotsEqual = (a: LayerSnapshot, b: LayerSnapshot) =>
  a.activeLayerId === b.activeLayerId &&
  areLayersEqual(a.layers, b.layers) &&
  areSelectionsEqual(a.selection, b.selection);

const pushCapped = (stack: LayerSnapshot[], snapshot: LayerSnapshot, maxHistory: number) => {
  if (stack.length === maxHistory) {
    stack.shift();
  }
  stack.push(snapshot);
};

/**
 * Undo/redo history for the editor.
 *
 * Snapshots are taken through `captureSnapshot` and restored through
 * `applySnapshot`, so the hook owns only the stacks and the action flags.
 * The returned functions change identity when those callbacks do, so callers
 * list them as dependencies like any other callback.
 */
export function useEditorHistory({
  captureSnapshot,
  applySnapshot,
  maxHistory = MAX_HISTORY,
}: EditorHistoryOptions): EditorHistory {
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoStackRef = useRef<LayerSnapshot[]>([]);
  const redoStackRef = useRef<LayerSnapshot[]>([]);
  const actionInProgressRef = useRef(false);
  const actionModifiedRef = useRef(false);

  const updateHistoryState = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const endAction = useCallback(() => {
    actionModifiedRef.current = false;
    actionInProgressRef.current = false;
  }, []);

  const recordSnapshot = useCallback(() => {
    const undoStack = undoStackRef.current;
    const snapshot = captureSnapshot();
    const lastSnapshot = undoStack[undoStack.length - 1];
    if (!lastSnapshot || !areSnapshotsEqual(lastSnapshot, snapshot)) {
      pushCapped(undoStack, snapshot, maxHistory);
    }
    redoStackRef.current = [];
    updateHistoryState();
  }, [captureSnapshot, maxHistory, updateHistoryState]);

  const commitSnapshot = useCallback(() => {
    recordSnapshot();
    endAction();
  }, [endAction, recordSnapshot]);

  const beginAction = useCallback(() => {
    if (actionInProgressRef.current) return;
    recordSnapshot();
    actionInProgressRef.current = true;
    actionModifiedRef.current = false;
  }, [recordSnapshot]);

  const beginActionWithSnapshot = useCallback(
    (snapshot: LayerSnapshot) => {
      pushCapped(undoStackRef.current, snapshot, maxHistory);
      redoStackRef.current = [];
      actionInProgressRef.current = true;
      actionModifiedRef.current = false;
      updateHistoryState();
    },
    [maxHistory, updateHistoryState],
  );

  const finalizeAction = useCallback(() => {
    if (!actionInProgressRef.current) return;
    const undoStack = undoStackRef.current;
    const lastSnapshot = undoStack[undoStack.length - 1];
    if (lastSnapshot && areSnapshotsEqual(lastSnapshot, captureSnapshot())) {
      undoStack.pop();
    }
    endAction();
    updateHistoryState();
  }, [captureSnapshot, endAction, updateHistoryState]);

  const markModified = useCallback(() => {
    actionModifiedRef.current = true;
  }, []);

  const saveStacks = useCallback(
    (): HistoryStacks => ({
      undo: undoStackRef.current.slice(),
      redo: redoStackRef.current.slice(),
    }),
    [],
  );

  const restoreStacks = useCallback(
    (stacks: HistoryStacks) => {
      undoStackRef.current = stacks.undo;
      redoStackRef.current = stacks.redo;
      endAction();
      updateHistoryState();
    },
    [endAction, updateHistoryState],
  );

  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    endAction();
    updateHistoryState();
  }, [endAction, updateHistoryState]);

  const step = useCallback(
    (from: LayerSnapshot[], to: LayerSnapshot[]) => {
      if (actionInProgressRef.current) return;
      if (!from.length) return;
      const target = from.pop();
      if (!target) return;
      pushCapped(to, captureSnapshot(), maxHistory);
      applySnapshot(target);
      endAction();
      updateHistoryState();
    },
    [applySnapshot, captureSnapshot, endAction, maxHistory, updateHistoryState],
  );

  const undo = useCallback(() => {
    step(undoStackRef.current, redoStackRef.current);
  }, [step]);

  const redo = useCallback(() => {
    step(redoStackRef.current, undoStackRef.current);
  }, [step]);

  return useMemo(
    () => ({
      canUndo,
      canRedo,
      recordSnapshot,
      commitSnapshot,
      beginAction,
      beginActionWithSnapshot,
      finalizeAction,
      markModified,
      saveStacks,
      restoreStacks,
      clear,
      undo,
      redo,
    }),
    [
      beginAction,
      beginActionWithSnapshot,
      canRedo,
      canUndo,
      clear,
      commitSnapshot,
      finalizeAction,
      markModified,
      recordSnapshot,
      redo,
      restoreStacks,
      saveStacks,
      undo,
    ],
  );
}
