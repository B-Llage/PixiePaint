import type { PixelValue } from "./PixelPencilTypes";

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
