import { bench, describe } from "vitest";

import {
  createScenario,
  runBucketFillEmpty,
  runRecompose64,
  runStroke,
  runTranslateStep,
  runUndoRedo,
  type Scenario,
} from "./perf-scenarios";

const SIZES = [256, 1024, 2048];

const SCENARIOS: [string, (scenario: Scenario) => unknown][] = [
  ["stroke (200 steps, 16px brush)", (scenario) => runStroke(scenario)],
  ["bucket fill of an empty canvas", runBucketFillEmpty],
  ["translate step (100 cells)", (scenario) => runTranslateStep(scenario)],
  ["recompose 64x64", runRecompose64],
  ["undo + redo of the stroke", runUndoRedo],
];

for (const size of SIZES) {
  describe(`${size}x${size}`, () => {
    const scenario = createScenario(size);
    for (const [name, run] of SCENARIOS) {
      bench(name, () => {
        run(scenario);
      });
    }
  });
}
