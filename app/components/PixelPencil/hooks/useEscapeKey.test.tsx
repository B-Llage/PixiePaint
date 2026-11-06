import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useEscapeKey } from "./useEscapeKey";

describe("useEscapeKey", () => {
  it("fires only while active and only for Escape", () => {
    const onEscape = vi.fn();
    const { rerender } = renderHook(({ active }) => useEscapeKey(active, onEscape), {
      initialProps: { active: false },
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();

    rerender({ active: true });
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("can ignore presses another handler already consumed", () => {
    const onEscape = vi.fn();
    renderHook(() => useEscapeKey(true, onEscape, { ignoreDefaultPrevented: true }));
    const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    consumed.preventDefault();

    window.dispatchEvent(consumed);
    expect(onEscape).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});
