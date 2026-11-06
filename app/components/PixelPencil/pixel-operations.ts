import type { Layer, PixelValue, SelectionPixel, SelectionState } from "./PixelPencilTypes";

type ComposableLayer = {
  visible: boolean;
  pixels: readonly PixelValue[];
};

export function translatePixels(
  pixels: readonly PixelValue[],
  width: number,
  height: number,
  dx: number,
  dy: number,
): PixelValue[] {
  const translated = new Array(width * height).fill(null) as PixelValue[];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const targetX = x + dx;
      const targetY = y + dy;
      if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
      translated[targetY * width + targetX] = pixels[y * width + x] ?? null;
    }
  }
  return translated;
}

export function composeLayers(layers: readonly ComposableLayer[], totalCells: number): PixelValue[] {
  const composed = new Array(totalCells).fill(null) as PixelValue[];
  for (let index = 0; index < totalCells; index += 1) {
    for (let layerIndex = layers.length - 1; layerIndex >= 0; layerIndex -= 1) {
      const layer = layers[layerIndex];
      if (!layer.visible) continue;
      const value = layer.pixels[index];
      if (value === null || value === "transparent") continue;
      composed[index] = value;
      break;
    }
  }
  return composed;
}

export const arePixelsEqual = (a: readonly PixelValue[], b: readonly PixelValue[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
};

/** Copies a layer, resizing its pixel array to `totalCells` and filling any new cells with `null`. */
export const cloneLayer = (layer: Layer, totalCells: number): Layer => {
  const pixels = new Array(totalCells).fill(null) as PixelValue[];
  const limit = Math.min(totalCells, layer.pixels.length);
  for (let index = 0; index < limit; index += 1) {
    pixels[index] = layer.pixels[index] ?? null;
  }
  return {
    ...layer,
    pixels,
  };
};

export const cloneLayers = (layers: readonly Layer[], totalCells: number) =>
  layers.map((layer) => cloneLayer(layer, totalCells));

export const cloneSelection = (selection: SelectionState | null): SelectionState | null => {
  if (!selection) return null;
  return {
    rect: { ...selection.rect },
    offset: { ...selection.offset },
    pixels: selection.pixels.map((pixel) => ({ ...pixel })),
    isFloating: selection.isFloating,
  };
};

const areSelectionPixelsEqual = (a: readonly SelectionPixel[], b: readonly SelectionPixel[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const pixelA = a[index];
    const pixelB = b[index];
    if (
      pixelA.relX !== pixelB.relX ||
      pixelA.relY !== pixelB.relY ||
      pixelA.color !== pixelB.color
    ) {
      return false;
    }
  }
  return true;
};

export const areSelectionsEqual = (a: SelectionState | null, b: SelectionState | null) => {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.rect.x === b.rect.x &&
    a.rect.y === b.rect.y &&
    a.rect.width === b.rect.width &&
    a.rect.height === b.rect.height &&
    a.offset.dx === b.offset.dx &&
    a.offset.dy === b.offset.dy &&
    a.isFloating === b.isFloating &&
    areSelectionPixelsEqual(a.pixels, b.pixels)
  );
};

export const areLayersEqual = (a: readonly Layer[], b: readonly Layer[]) => {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const layerA = a[index];
    const layerB = b[index];
    if (
      layerA.id !== layerB.id ||
      layerA.name !== layerB.name ||
      layerA.visible !== layerB.visible ||
      !arePixelsEqual(layerA.pixels, layerB.pixels)
    ) {
      return false;
    }
  }
  return true;
};

/** Picks the first unused `Layer N` name, starting from one past the current layer count. */
export const generateLayerName = (existingLayers: readonly Layer[]) => {
  let suffix = existingLayers.length + 1;
  while (existingLayers.some((layer) => layer.name === `Layer ${suffix}`)) {
    suffix += 1;
  }
  return `Layer ${suffix}`;
};
