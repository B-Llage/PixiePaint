import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesces redraw requests into one animation frame and fans the frame out
 * to subscribed renderers. Both returned functions have stable identities.
 */
export function useRedrawSignal() {
  const listenersRef = useRef(new Set<() => void>());
  const frameRef = useRef<number | null>(null);

  const requestRedraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      for (const listener of Array.from(listenersRef.current)) listener();
    });
  }, []);

  const subscribe = useCallback((listener: () => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  return { requestRedraw, subscribe };
}
