import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Layer } from "../PixelPencilTypes";
import { composeInto, createBuffer, unionRect } from "../pixel-buffer";
import type { DirtyRect, PixelBuffer } from "../pixel-buffer";

type Params = { layersRef: RefObject<Layer[]>; width: number; height: number };

/**
 * Owns the flattened composite of all visible layers. `recompose(rect)` is
 * bounded by the rect; the renderer reads `dirtyRef` and clears it after upload.
 * A size change yields a new `composite` identity (consumers key on it);
 * `compositeVersion` only bumps from `recompose`.
 */
export function useComposite({ layersRef, width, height }: Params) {
  const composite = useMemo(() => createBuffer(width, height), [width, height]);
  const compositeRef = useRef<PixelBuffer>(composite);
  const dirtyRef = useRef<DirtyRect | null>(null);
  const [compositeVersion, setCompositeVersion] = useState(0);

  // A new buffer (first mount or size change) is fully composed and marked fully dirty.
  useEffect(() => {
    compositeRef.current = composite;
    // Layers may briefly have another size while a resize propagates; skip them.
    const matching = layersRef.current.filter(
      (l) => l.pixels.width === composite.width && l.pixels.height === composite.height,
    );
    composeInto(composite, matching, null);
    dirtyRef.current = { x: 0, y: 0, width: composite.width, height: composite.height };
  }, [composite, layersRef]);

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

  return { composite, compositeRef, compositeVersion, dirtyRef, recompose };
}
