import { EMPTY_PIXEL } from "./pixel-buffer";
import type { Layer, SelectionState } from "./PixelPencilTypes";

export const cloneSelection = (selection: SelectionState | null): SelectionState | null => {
  if (!selection) return null;
  return {
    rect: { ...selection.rect },
    offset: { ...selection.offset },
    data: selection.data.slice(),
    isFloating: selection.isFloating,
  };
};

export const areSelectionsEqual = (a: SelectionState | null, b: SelectionState | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.rect.x !== b.rect.x ||
    a.rect.y !== b.rect.y ||
    a.rect.width !== b.rect.width ||
    a.rect.height !== b.rect.height ||
    a.offset.dx !== b.offset.dx ||
    a.offset.dy !== b.offset.dy ||
    a.isFloating !== b.isFloating ||
    a.data.length !== b.data.length
  ) {
    return false;
  }
  for (let index = 0; index < a.data.length; index += 1) {
    if (a.data[index] !== b.data[index]) return false;
  }
  return true;
};

/** True when any selection cell holds a value, including an explicit transparent cell. */
export const hasSelectionPixels = (selection: SelectionState | null): boolean => {
  if (!selection) return false;
  const { data } = selection;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== EMPTY_PIXEL) return true;
  }
  return false;
};

/** Picks the first unused `Layer N` name, starting from one past the current layer count. */
export const generateLayerName = (existingLayers: readonly Layer[]) => {
  let suffix = existingLayers.length + 1;
  while (existingLayers.some((layer) => layer.name === `Layer ${suffix}`)) {
    suffix += 1;
  }
  return `Layer ${suffix}`;
};
