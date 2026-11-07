import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRedrawSignal } from "./useRedrawSignal";

function setup() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames[id - 1] = () => {};
  });
  const runFrames = () =>
    act(() => {
      for (const frame of frames.splice(0, frames.length)) frame(0);
    });
  return { frames, runFrames, hook: renderHook(() => useRedrawSignal()) };
}

afterEach(() => vi.unstubAllGlobals());

describe("useRedrawSignal", () => {
  it("coalesces several requests into one frame and one notification", () => {
    const { frames, runFrames, hook } = setup();
    const a = vi.fn();
    const b = vi.fn();
    hook.result.current.subscribe(a);
    hook.result.current.subscribe(b);
    hook.result.current.requestRedraw();
    hook.result.current.requestRedraw();
    hook.result.current.requestRedraw();
    expect(frames).toHaveLength(1);
    runFrames();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    hook.result.current.requestRedraw();
    runFrames();
    expect(a).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const { runFrames, hook } = setup();
    const listener = vi.fn();
    const unsubscribe = hook.result.current.subscribe(listener);
    unsubscribe();
    hook.result.current.requestRedraw();
    runFrames();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps stable identities and cancels the pending frame on unmount", () => {
    const { runFrames, hook } = setup();
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current.requestRedraw).toBe(first.requestRedraw);
    expect(hook.result.current.subscribe).toBe(first.subscribe);
    const listener = vi.fn();
    first.subscribe(listener);
    first.requestRedraw();
    hook.unmount();
    runFrames();
    expect(listener).not.toHaveBeenCalled();
  });
});
