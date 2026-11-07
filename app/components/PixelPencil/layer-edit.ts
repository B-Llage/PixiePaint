import type { DirtyRect, PixelBuffer } from "./pixel-buffer";

/** Mutates a layer buffer in place and returns the rect of cells it changed, or null if none. */
export type LayerEdit = (buffer: PixelBuffer) => DirtyRect | null;

/**
 * Edits one layer inside `rect`: the editor records the rect's history tiles first, runs
 * `mutate`, and recomposites what it reports changed. Returns the changed rect, or null.
 */
export type EditLayer = (layerId: string, rect: DirtyRect, mutate: LayerEdit) => DirtyRect | null;
