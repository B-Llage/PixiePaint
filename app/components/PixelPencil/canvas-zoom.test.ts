import { describe, expect, it } from "vitest";

import {
  clampZoomScale,
  FIT_ZOOM_MAX_PADDING,
  FIT_ZOOM_MIN_PADDING,
  FIT_ZOOM_PADDING_RATIO,
  getFitZoomPadding,
  getFitZoomScale,
  getNextZoomScale,
} from "./canvas-zoom";

describe("getFitZoomPadding", () => {
  it("scales with the viewport's shorter side within its clamp range", () => {
    expect(getFitZoomPadding(1200, 800)).toBeCloseTo(800 * FIT_ZOOM_PADDING_RATIO);
    expect(getFitZoomPadding(300, 200)).toBe(FIT_ZOOM_MIN_PADDING);
    expect(getFitZoomPadding(4000, 3000)).toBe(FIT_ZOOM_MAX_PADDING);
  });

  it("never takes more than a quarter of a tiny viewport", () => {
    expect(getFitZoomPadding(40, 40)).toBe(10);
  });

  it("is zero before the viewport is measured", () => {
    expect(getFitZoomPadding(0, 0)).toBe(0);
  });
});

describe("getFitZoomScale", () => {
  it("fits a 2000x2000 canvas in a narrow viewport with padding on every side", () => {
    const padding = getFitZoomPadding(360, 500);
    expect(padding).toBeGreaterThan(0);
    const scale = getFitZoomScale(2000, 2000, 360, 500, 1);
    expect(2000 * scale).toBeCloseTo(360 - padding * 2);
    expect(2000 * scale).toBeLessThanOrEqual(500 - padding * 2);
  });

  it("pads the limiting axis of a wide canvas", () => {
    const padding = getFitZoomPadding(1200, 800);
    const scale = getFitZoomScale(2000, 100, 1200, 800, 4);
    expect(2000 * 4 * scale).toBeCloseTo(1200 - padding * 2);
    expect(100 * 4 * scale).toBeLessThanOrEqual(800 - padding * 2);
  });

  it("goes below 1 when the default view fills the viewport edge to edge", () => {
    // 16 cells of 16px fill a 256px viewport exactly, leaving no margin.
    const scale = getFitZoomScale(16, 16, 256, 256, 16);
    const padding = getFitZoomPadding(256, 256);
    expect(scale).toBeLessThan(1);
    expect(16 * 16 * scale).toBeCloseTo(256 - padding * 2);
  });

  it("never exceeds 1 when the canvas already fits with padding", () => {
    expect(getFitZoomScale(16, 16, 800, 800, 10)).toBe(1);
  });

  it("falls back to 1 before the viewport is measured", () => {
    expect(getFitZoomScale(64, 64, 0, 0, 8)).toBe(1);
  });
});

describe("getNextZoomScale", () => {
  it("steps by whole multiples above 1x", () => {
    expect(getNextZoomScale(1, "in", 1, 0.1, 5)).toBe(2);
    expect(getNextZoomScale(3, "out", 2, 0.1, 5)).toBe(1);
  });

  it("halves below 1x and stops at the fit scale", () => {
    expect(getNextZoomScale(1, "out", 1, 0.1, 5)).toBe(0.5);
    expect(getNextZoomScale(1, "out", 10, 0.1, 5)).toBe(0.1);
  });

  it("zooms back in from the fit scale through 1x", () => {
    expect(getNextZoomScale(0.1, "in", 1, 0.1, 5)).toBe(0.2);
    expect(getNextZoomScale(0.6, "in", 1, 0.1, 5)).toBe(1);
    expect(getNextZoomScale(0.6, "in", 2, 0.1, 5)).toBe(2);
  });

  it("respects the maximum", () => {
    expect(getNextZoomScale(4, "in", 4, 0.5, 5)).toBe(5);
  });
});

describe("clampZoomScale", () => {
  it("raises a stale scale to a new, larger fit scale", () => {
    expect(clampZoomScale(0.1, 0.4, 5)).toBe(0.4);
  });
});
