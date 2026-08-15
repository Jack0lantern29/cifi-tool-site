import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProgressView,
  formatDuration,
  formatNodeCount,
  formatRelativeGap
} from "../src/progress.js";
import { optimize } from "../src/optimizer.js";
import { PROOF_RELATIVE_GAP } from "../src/objective.js";
import { createDefaultInput } from "../src/validation.js";

test("formatDuration presents seconds, minutes, and hours", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(999), "<1s");
  assert.equal(formatDuration(59_999), "59s");
  assert.equal(formatDuration(65_000), "1m 5s");
  assert.equal(formatDuration(3_723_000), "1h 2m 3s");
  assert.equal(formatDuration(Infinity), "—");
  assert.equal(formatDuration(-1), "—");
});

test("formatNodeCount accepts finite non-negative counts only", () => {
  assert.equal(formatNodeCount(12_345.9), "12,345");
  assert.equal(formatNodeCount(0), "0");
  assert.equal(formatNodeCount(-1), null);
  assert.equal(formatNodeCount(Number.NaN), null);
});

test("formatRelativeGap formats finite non-negative ratios", () => {
  assert.equal(formatRelativeGap(0.12345), "12.35%");
  assert.equal(formatRelativeGap(0), "0%");
  assert.equal(formatRelativeGap(0.000001), "0.0001%");
  assert.equal(formatRelativeGap(0.0000001), "<0.0001%");
  assert.equal(formatRelativeGap(Infinity), null);
  assert.equal(formatRelativeGap(-0.1), null);
});

test("buildProgressView distinguishes determinate and indeterminate phases", () => {
  assert.deepEqual(buildProgressView({
    phase: "standard-optimising",
    determinate: true,
    completed: 4,
    total: 10
  }), {
    phaseLabel: "Optimising farms…",
    determinate: true,
    completed: 4,
    total: 10,
    nodeText: null,
    gapText: null
  });

  assert.deepEqual(buildProgressView({
    phase: "crazy-primary",
    determinate: false,
    completed: 0,
    total: 1,
    nodes: 987,
    relativeGap: 0.05
  }), {
    phaseLabel: "Optimising primary objective…",
    determinate: false,
    completed: 0,
    total: 1,
    nodeText: "987",
    gapText: "5%"
  });
});

test("standard optimisation marks every progress event as determinate", () => {
  const events = [];
  optimize(createDefaultInput(), { onProgress: progress => events.push(progress) });
  assert.ok(events.length > 0);
  assert.ok(events.every(progress => progress.determinate === true));
  assert.equal(events.at(-1).phase, "complete");
});

test("Overkill uses a 0.0001% relative-gap tolerance", () => {
  assert.equal(PROOF_RELATIVE_GAP, 0.000001);
});
