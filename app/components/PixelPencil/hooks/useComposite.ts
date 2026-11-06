import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Layer } from "../PixelPencilTypes";
import { composeInto, createBuffer, unionRect } from "../pixel-buffer";
import type { DirtyRect, PixelBuffer } from "../pixel-buffer";

type Params = { layersRef: RefObject<Layer[]>; width: number; height: number };

/**
 * Owns the flattened composite of all visible layers. `recompose(rect)` is
 * bounded by the rect; the renderer reads `dirtyRef` and clears it after upload.
 */
export function useComposite({ layersRef, width, height }: Params) {
  const composite = useMemo(() => createBuffer(width, height), [width, height]);
  const compositeRef = useRef<PixelBuffer>(composite);
  const dirtyRef = useRef<DirtyRect | null>(null);
  const [compositeVersion, setCompositeVersion] = useState(0);

  // A new buffer (first mount or size change) is fully composed, marked fully
  // dirty, and announced via the version bump.
  useEffect(() => {
    compositeRef.current = composite;
    // Layers may briefly have another size while a resize propagates; skip them.
    const matching = layersRef.current.filter(
      (l) => l.pixels.width === composite.width && l.pixels.height === composite.height,
    );
    composeInto(composite, matching, null);
    dirtyRef.current = { x: 0, y: 0, width: composite.width, height: composite.height };
    // The version must change once the new buffer has been composed so consumers re-render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompositeVersion((v) => v + 1);
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
