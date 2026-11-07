import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MAX_ZOOM_SCALE } from "../PixelPencil.constants";
import { useCanvasViewport, type CanvasViewportOptions } from "./useCanvasViewport";

const CANVAS_RECT = { left: 10, top: 20 };

function setup(overrides: Partial<CanvasViewportOptions> = {}) {
  const gridRef = {
    current: {
      getBoundingClientRect: () => ({ ...CANVAS_RECT, width: 0, height: 0 }),
    } as unknown as HTMLCanvasElement,
  };
  const gridWrapperRef = { current: null as HTMLDivElement | null };
  const options: CanvasViewportOptions = {
    gridWidth: 16,
    gridHeight: 16,
    canvasPixelSize: 16,
    isMobile: false,
    gridWrapperRef,
    gridRef,
    ...overrides,
  };
  const hook = renderHook((props: CanvasViewportOptions) => useCanvasViewport(props), {
    initialProps: options,
  });
  const resize = (width: number, height: number) =>
    act(() => hook.result.current.handleViewportResize({ width, height }));
  return { hook, options, resize };
}

describe("useCanvasViewport", () => {
  it("uses the persisted cell size until the available space is measured", () => {
    const { hook } = setup({ canvasPixelSize: 12 });
    expect(hook.result.current.baseCellSize).toBe(12);
    expect(hook.result.current.displayCellSize).toBe(12);
    expect(hook.result.current.contentWidth).toBe(16 * 12);
  });

  it("centers the artwork when it fits the viewport and not when it overflows", () => {
    const { hook, resize } = setup();
    resize(400, 300);
    expect(hook.result.current.renderOffsetX).toBe((400 - 256) / 2);
    expect(hook.result.current.renderOffsetY).toBe((300 - 256) / 2);

    resize(200, 300);
    expect(hook.result.current.renderOffsetX).toBe(0);
    expect(hook.result.current.renderOffsetY).toBe((300 - 256) / 2);
  });

  it("clamps the pan offset to the shared pan bounds", () => {
    const { hook, resize } = setup();
    resize(300, 300);
    // Content 256 wide in a 300 viewport: at least 216px must stay visible.
    act(() => hook.result.current.setCanvasScroll({ x: 1000, y: -1000 }));
    expect(hook.result.current.canvasScroll).toEqual({ x: 22 + 256 - 216, y: 22 - 300 + 216 });

    act(() => hook.result.current.setCanvasScroll((prev) => ({ x: prev.x - 10, y: prev.y })));
    expect(hook.result.current.canvasScroll.x).toBe(22 + 256 - 216 - 10);
  });

  it("resolves client points to fractional cells and rejects outside points unless clamped", () => {
    const { hook, resize } = setup();
    resize(400, 400);
    const offset = (400 - 256) / 2;
    const inside = hook.result.current.resolvePositionFromClientPoint(
      CANVAS_RECT.left + offset + 40,
      CANVAS_RECT.top + offset + 8,
    );
    expect(inside).toEqual({ x: 2.5, y: 0.5 });

    const outside = hook.result.current.resolvePositionFromClientPoint(CANVAS_RECT.left, CANVAS_RECT.top);
    expect(outside).toBeNull();

    const clamped = hook.result.current.resolvePositionFromClientPoint(CANVAS_RECT.left, CANVAS_RECT.top, {
      clamp: true,
    });
    expect(clamped).toEqual({ x: 0, y: 0 });
  });

  it("returns null before the canvas exists", () => {
    const { hook } = setup({ gridRef: { current: null } });
    expect(hook.result.current.resolvePositionFromClientPoint(50, 50)).toBeNull();
  });

  it("zooms around the client point so the same artwork point stays under it", () => {
    const { hook, resize } = setup();
    resize(400, 400);
    const offset = (400 - 256) / 2;
    const clientX = CANVAS_RECT.left + offset + 40;
    const clientY = CANVAS_RECT.top + offset + 8;
    const before = hook.result.current.resolvePositionFromClientPoint(clientX, clientY);

    act(() => hook.result.current.zoomAtClientPoint("in", 1, clientX, clientY));
    expect(hook.result.current.zoomScale).toBe(2);
    expect(hook.result.current.displayCellSize).toBe(32);
    expect(hook.result.current.resolvePositionFromClientPoint(clientX, clientY)).toEqual(before);

    act(() => hook.result.current.handleWheelZoom("out", 1, { x: clientX, y: clientY }));
    expect(hook.result.current.zoomScale).toBe(1);
    expect(hook.result.current.resolvePositionFromClientPoint(clientX, clientY)).toEqual(before);
  });

  it("clamps zoom between the fit scale (1 when the artwork fits) and the maximum, leaving the pan alone at the limits", () => {
    const { hook, resize } = setup();
    resize(400, 400);
    const pan = { ...hook.result.current.canvasScroll };

    act(() => hook.result.current.zoomAtClientPoint("out", 1, 100, 100));
    expect(hook.result.current.zoomScale).toBe(1);
    expect(hook.result.current.canvasScroll).toEqual(pan);

    act(() => hook.result.current.zoomAtClientPoint("in", 50, 100, 100));
    expect(hook.result.current.zoomScale).toBe(MAX_ZOOM_SCALE);
    const zoomedPan = { ...hook.result.current.canvasScroll };
    act(() => hook.result.current.zoomAtClientPoint("in", 1, 100, 100));
    expect(hook.result.current.canvasScroll).toEqual(zoomedPan);
  });

  it("zooms out by halvings until the whole overflowing artwork fits, then centers it", () => {
    // 2048 cells at 4px is 8192px: far larger than a 600x400 viewport at 1x.
    const { hook, resize } = setup({ gridWidth: 2048, gridHeight: 2048, canvasPixelSize: 4 });
    resize(600, 400);
    expect(hook.result.current.contentWidth).toBe(8192);
    expect(hook.result.current.minZoomScale).toBeCloseTo(400 / 8192);

    act(() => hook.result.current.zoomAtClientPoint("out", 1, 300, 300));
    expect(hook.result.current.zoomScale).toBe(0.5);

    act(() => hook.result.current.zoomAtClientPoint("out", 20, 300, 300));
    const { contentWidth, contentHeight, canvasScroll, renderOffsetX, renderOffsetY } = hook.result.current;
    expect(contentHeight).toBeCloseTo(400);
    expect(contentWidth).toBeLessThanOrEqual(600);
    expect(canvasScroll).toEqual({ x: 0, y: 0 });
    expect(renderOffsetX).toBeCloseTo((600 - contentWidth) / 2);
    expect(renderOffsetY).toBeCloseTo(0);

    // Already at the fit scale: further zoom out changes nothing.
    act(() => hook.result.current.zoomAtClientPoint("out", 1, 300, 300));
    expect(hook.result.current.contentHeight).toBeCloseTo(400);
    expect(hook.result.current.canvasScroll).toEqual({ x: 0, y: 0 });

    act(() => hook.result.current.zoomAtClientPoint("in", 20, 300, 300));
    expect(hook.result.current.zoomScale).toBe(MAX_ZOOM_SCALE);
  });

  it("raises a fit zoom when the viewport grows so the artwork still fills it", () => {
    const { hook, resize } = setup({ gridWidth: 256, gridHeight: 256, canvasPixelSize: 4 });
    resize(200, 200);
    act(() => hook.result.current.zoomAtClientPoint("out", 10, 100, 100));
    expect(hook.result.current.contentWidth).toBeCloseTo(200);

    resize(400, 400);
    expect(hook.result.current.contentWidth).toBeCloseTo(400);
    resize(2000, 2000);
    expect(hook.result.current.zoomScale).toBe(1);
  });

  it("keeps a zoom-created offset beyond the usual bounds until the viewport resizes", () => {
    const { hook, resize } = setup();
    resize(300, 300);
    act(() => hook.result.current.zoomAtClientPoint("in", 1, CANVAS_RECT.left + 150, CANVAS_RECT.top + 150));
    act(() => hook.result.current.setCanvasScroll({ x: 1000, y: 0 }));
    expect(hook.result.current.canvasScroll.x).toBe(512 - 216);

    // Zooming out at the left edge anchors a point far to the right, past the usual range.
    act(() => hook.result.current.zoomAtClientPoint("out", 1, CANVAS_RECT.left, CANVAS_RECT.top + 150));
    const usualMax = 22 + 256 - 216;
    expect(hook.result.current.canvasScroll.x).toBe(170);
    expect(170).toBeGreaterThan(usualMax);

    // Panning cannot go farther out, but stays where the zoom left it.
    act(() => hook.result.current.setCanvasScroll((prev) => ({ x: prev.x + 50, y: prev.y })));
    expect(hook.result.current.canvasScroll.x).toBe(170);
    // Panning back toward the usual range shrinks the exception.
    act(() => hook.result.current.setCanvasScroll((prev) => ({ x: prev.x - 10, y: prev.y })));
    expect(hook.result.current.canvasScroll.x).toBe(160);
    act(() => hook.result.current.setCanvasScroll((prev) => ({ x: prev.x + 50, y: prev.y })));
    expect(hook.result.current.canvasScroll.x).toBe(160);

    resize(300, 301);
    expect(hook.result.current.canvasScroll.x).toBe(usualMax);
  });

  it("drops the zoom exception when the grid size changes", () => {
    const { hook, resize, options } = setup();
    resize(300, 300);
    act(() => hook.result.current.zoomAtClientPoint("in", 1, CANVAS_RECT.left + 150, CANVAS_RECT.top + 150));
    act(() => hook.result.current.setCanvasScroll({ x: 1000, y: 0 }));
    act(() => hook.result.current.zoomAtClientPoint("out", 1, CANVAS_RECT.left, CANVAS_RECT.top + 150));
    expect(hook.result.current.canvasScroll.x).toBe(170);

    hook.rerender({ ...options, gridWidth: 8 });
    // 8 cells * 16px = 128 wide, centered at offset 86: max pan is 86 + 128 - 128.
    expect(hook.result.current.canvasScroll.x).toBe(86);
  });

  it("honors the mobile and desktop minimum cell sizes against a tight viewport", () => {
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    const wrapper = document.createElement("div");
    const parent = document.createElement("div");
    parent.appendChild(wrapper);
    Object.defineProperty(parent, "clientWidth", { value: 32 });
    Object.defineProperty(parent, "clientHeight", { value: 32 });
    const gridWrapperRef = { current: wrapper };

    const desktop = setup({ gridWrapperRef, isMobile: false });
    expect(desktop.hook.result.current.availableWidth).toBe(32);
    expect(desktop.hook.result.current.baseCellSize).toBe(4);

    const mobile = setup({ gridWrapperRef, isMobile: true });
    expect(mobile.hook.result.current.baseCellSize).toBe(2);
  });
});
