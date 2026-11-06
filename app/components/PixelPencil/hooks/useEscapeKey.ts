import { useEffect } from "react";

interface UseEscapeKeyOptions {
  /** Skip presses that another handler has already consumed. */
  ignoreDefaultPrevented?: boolean;
}

/** Calls `onEscape` when Escape is pressed anywhere in the window while `active` is true. */
export function useEscapeKey(
  active: boolean,
  onEscape: () => void,
  { ignoreDefaultPrevented = false }: UseEscapeKeyOptions = {},
) {
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (ignoreDefaultPrevented && event.defaultPrevented) return;
      onEscape();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, ignoreDefaultPrevented, onEscape]);
}
