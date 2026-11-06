import { useCallback, useRef, useState } from "react";
import type { RefObject, SetStateAction } from "react";

/**
 * `useState` whose latest value is also readable synchronously through a ref.
 *
 * Pointer and keyboard handlers in the editor are registered once and must see
 * the current layers, pixels, and selection without re-subscribing on every
 * render. This hook keeps a single setter that resolves functional updates
 * against the ref, writes the ref, and then schedules the React update, so the
 * ref is always the latest value passed to the setter even before React
 * re-renders. The setter returns the resolved value.
 *
 * Unlike React's setState, a functional update runs synchronously and exactly
 * once, so updaters may set flags that the caller reads immediately after.
 */
export function useStateWithRef<T>(
  initialValue: T | (() => T),
): [T, (next: SetStateAction<T>) => T, RefObject<T>] {
  const [value, setValue] = useState<T>(initialValue);
  const ref = useRef<T>(value);

  const set = useCallback((next: SetStateAction<T>): T => {
    const resolved =
      typeof next === "function"
        ? (next as (previous: T) => T)(ref.current)
        : next;
    ref.current = resolved;
    setValue(resolved);
    return resolved;
  }, []);

  return [value, set, ref];
}
