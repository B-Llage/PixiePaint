import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Layer } from "../PixelPencilTypes";
import { composeInto, createBuffer, unionRect } from "../pixel-buffer";
import type { DirtyRect, PixelBuffer } from "../pixel-buffer";

type Params = { layersRef: RefObject<Layer[]>; width: number; height: number };

function buildComposite(layers: Layer[], width: number, height: number): PixelBuffer {
  const buffer = createBuffer(width, height);
  // Layers may briefly have another size while a resize propagates; skip them.
  const matching = layers.filter((l) => l.pixels.width === width && l.pixels.height === height);
  composeInto(buffer, matching, null);
  return buffer;
}

/**
 * Owns the flattened composite of all visible layers. `recompose(rect)` is
 * bounded by the rect; the renderer reads `dirtyRef` and clears it after upload.
 */
export function useComposite({ layersRef, width, height }: Params) {
  const compositeRef = useRef<PixelBuffer>(null as unknown as PixelBuffer);
  const dirtyRef = useRef<DirtyRect | null>(null);
  const [builtFor, setBuiltFor] = useState<{ width: number; height: number } | null>(null);
  const [compositeVersion, setCompositeVersion] = useState(0);

  // Adjust-state-during-render: rebuild synchronously so no frame sees a
  // composite of the wrong size, then schedule the version bump.
  if (!builtFor || builtFor.width !== width || builtFor.height !== height) {
    compositeRef.current = buildComposite(layersRef.current, width, height);
    dirtyRef.current = { x: 0, y: 0, width, height };
    setBuiltFor({ width, height });
    setCompositeVersion((v) => v + 1);
  }

  const recompose = useCallback(
    (rect: DirtyRect | null) => {
      const composite = compositeRef.current;
      composeInto(composite, layersRef.current, rect);
      const full = { x: 0, y: 0, width: composite.width, height: composite.height };
      dirtyRef.current = unionRect(dirtyRef.current, rect ?? full);
      setCompositeVersion((v) => v + 1);
    },
    [layersRef],
  );

  return { compositeRef, compositeVersion, dirtyRef, recompose };
}
