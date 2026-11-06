import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStateWithRef } from "./useStateWithRef";

describe("useStateWithRef", () => {
  it("initializes the ref and the state from the same value, including lazy initializers", () => {
    const { result } = renderHook(() => useStateWithRef(() => [1, 2, 3]));
    const [value, , ref] = result.current;

    expect(value).toEqual([1, 2, 3]);
    expect(ref.current).toBe(value);
  });

  it("updates the ref synchronously, before React re-renders", () => {
    const { result } = renderHook(() => useStateWithRef(0));
    const [, set, ref] = result.current;

    act(() => {
      set(5);
      expect(ref.current).toBe(5);
      expect(result.current[0]).toBe(0);
    });

    expect(result.current[0]).toBe(5);
    expect(result.current[2].current).toBe(5);
  });

  it("resolves functional updates against the latest ref value and returns the result", () => {
    const { result } = renderHook(() => useStateWithRef(1));
    const [, set, ref] = result.current;

    act(() => {
      expect(set((previous) => previous + 1)).toBe(2);
      expect(set((previous) => previous * 10)).toBe(20);
      expect(ref.current).toBe(20);
    });

    expect(result.current[0]).toBe(20);
  });

  it("runs a functional update exactly once so callers can read flags set inside it", () => {
    const { result } = renderHook(() => useStateWithRef<number[]>([]));
    const [, set] = result.current;
    let calls = 0;

    act(() => {
      set((previous) => {
        calls += 1;
        return [...previous, calls];
      });
      expect(calls).toBe(1);
    });

    expect(calls).toBe(1);
    expect(result.current[0]).toEqual([1]);
  });

  it("keeps the setter and ref identities stable across renders", () => {
    const { result, rerender } = renderHook(() => useStateWithRef("a"));
    const [, set, ref] = result.current;

    act(() => {
      set("b");
    });
    rerender();

    expect(result.current[1]).toBe(set);
    expect(result.current[2]).toBe(ref);
    expect(result.current[0]).toBe("b");
  });
});
