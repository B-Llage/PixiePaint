import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Layer } from "../PixelPencilTypes";
import { composeInto, createBuffer, unionRect } from "../pixel-buffer";
import type { DirtyRect, PixelBuffer } from "../pixel-buffer";

type Params = {
  layersRef: RefObject<Layer[]>;
  width: number;
  height: number;
  /** Called after a new buffer has been fully composed and marked fully dirty. */
  onComposed?: () => void;
};

/** Layers may briefly have another size while a resize propagates; skip them. */
function layersMatching(layers: Layer[], buffer: PixelBuffer): Layer[] {
  return layers.filter((l) => l.pixels.width === buffer.width && l.pixels.height === buffer.height);
}

/**
 * Owns the flattened composite of all visible layers. `recompose(rect)` is
 * bounded by the rect; the renderer reads `dirtyRef` and clears it after upload.
 * A size change yields a new `composite` identity (consumers key on it);
 * `compositeVersion` only bumps from `recompose`. After each full compose of a
 * new buffer (mount or size change) the optional `onComposed` callback runs so
 * the caller can request a redraw; `recompose` does not call it. Layers whose
 * size differs from the composite are ignored by both paths.
 */
export function useComposite({ layersRef, width, height, onComposed }: Params) {
  const composite = useMemo(() => createBuffer(width, height), [width, height]);
  const compositeRef = useRef<PixelBuffer>(composite);
  const dirtyRef = useRef<DirtyRect | null>(null);
  const onComposedRef = useRef(onComposed);
  const [compositeVersion, setCompositeVersion] = useState(0);

  useEffect(() => {
    onComposedRef.current = onComposed;
  }, [onComposed]);

  // A new buffer (first mount or size change) is fully composed and marked fully dirty.
  useEffect(() => {
    compositeRef.current = composite;
    composeInto(composite, layersMatching(layersRef.current, composite), null);
    dirtyRef.current = { x: 0, y: 0, width: composite.width, height: composite.height };
    onComposedRef.current?.();
  }, [composite, layersRef]);

  const recompose = useCallback(
    (rect: DirtyRect | null) => {
      const composite = compositeRef.current;
      composeInto(composite, layersMatching(layersRef.current, composite), rect);
      const full = { x: 0, y: 0, width: composite.width, height: composite.height };
      dirtyRef.current = unionRect(dirtyRef.current, rect ?? full);
      setCompositeVersion((v) => v + 1);
    },
    [layersRef],
  );

  return { composite, compositeRef, compositeVersion, dirtyRef, recompose };
}
