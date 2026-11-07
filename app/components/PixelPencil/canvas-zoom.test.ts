import { describe, expect, it } from "vitest";

import { clampZoomScale, getFitZoomScale, getNextZoomScale } from "./canvas-zoom";

describe("getFitZoomScale", () => {
  it("returns a scale that fits a 2000x2000 canvas in a narrow viewport", () => {
    const scale = getFitZoomScale(2000, 2000, 360, 500, 1);
    expect(2000 * scale).toBeLessThanOrEqual(360);
    expect(2000 * scale).toBeCloseTo(360);
  });

  it("fits the limiting axis of a wide canvas", () => {
    const scale = getFitZoomScale(2000, 100, 1200, 800, 4);
    expect(2000 * 4 * scale).toBeCloseTo(1200);
    expect(100 * 4 * scale).toBeLessThanOrEqual(800);
  });

  it("never exceeds 1 when the canvas already fits", () => {
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
