import { describe, expect, it } from "vitest";

import { isPaintedPixel } from "./pixel-buffer";
import {
  createScenario,
  runBucketFillEmpty,
  runRecompose64,
  runStroke,
  runTranslateStep,
  runUndoRedo,
} from "./perf-scenarios";

describe("perf scenarios", () => {
  it("every scenario runs at 256 and reports a dirty rect bounded by its touched area", () => {
    const size = 256;
    const scenario = createScenario(size);
    expect(scenario.layers).toHaveLength(3);
    expect(scenario.layers[0].data.some(isPaintedPixel)).toBe(true);

    const strokeRect = runStroke(scenario);
    expect(strokeRect).not.toBeNull();
    expect(strokeRect!.width * strokeRect!.height).toBeLessThan((size * size) / 4);

    const fillRect = runBucketFillEmpty(scenario);
    expect(fillRect).toEqual({ x: 0, y: 0, width: size, height: size });

    const translateRect = runTranslateStep(scenario);
    expect(translateRect).not.toBeNull();

    const recomposeRect = runRecompose64(scenario);
    expect(recomposeRect.width * recomposeRect.height).toBe(64 * 64);

    expect(runUndoRedo(scenario)).toBeGreaterThan(0);
  });

  it("undo and redo replay leaves exactly the stroked pixels", () => {
    const scenario = createScenario(128);
    const original = scenario.layers[0].data.slice();
    const reference = createScenario(128);
    runStroke(reference);
    runUndoRedo(scenario);
    runUndoRedo(scenario);
    expect(scenario.layers[0].data).not.toEqual(original);
    expect(scenario.layers[0].data).toEqual(reference.layers[0].data);
  });
});
