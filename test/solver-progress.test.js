import assert from "node:assert/strict";
import test from "node:test";
import { createSolverProgress } from "../src/solver-progress.js";
import { formatSolverUpdateAge, formatSolverWork } from "../src/progress.js";

test("activity changes only for real reports and search counters reset", () => {
  let time = 0;
  const events = [];
  const tracker = createSolverProgress(progress => events.push(progress), 0, () => time);
  tracker.start("crazy-primary");
  assert.equal(events.at(-1).solverUpdate, 0);
  tracker.report({ mip_node_count: 0n, mip_total_lp_iterations: 12n }, "Searching allocations");
  assert.equal(events.at(-1).solverUpdate, 1);
  assert.equal(events.at(-1).solverIterations, 12);
  time = 100;
  tracker.report({ mip_node_count: 2n }, "Searching allocations");
  assert.equal(events.length, 2);
  time = 250;
  tracker.report({}, "Solving a relaxation");
  assert.equal(events.at(-1).solverNodes, 2);
  assert.equal(events.at(-1).solverIterations, 12);
  assert.equal(events.at(-1).solverUpdate, 2);
  time = 10000;
  assert.equal(events.length, 3);
  tracker.start("crazy-tiebreak");
  assert.equal(events.at(-1).solverSearch, 2);
  assert.equal(events.at(-1).solverNodes, null);
  assert.equal(events.at(-1).solverIterations, null);
  assert.equal(events.at(-1).solverUpdate, 2);
  assert.equal(events.at(-1).relativeGap, null);
  tracker.report({ mip_node_count: 0n }, "Checking search result", true);
  assert.equal(events.at(-1).solverUpdate, 3);
});

test("activity labels show fresh and stale updates without claiming completion", () => {
  assert.equal(formatSolverUpdateAge(null), "No solver update yet");
  assert.equal(formatSolverUpdateAge(300), "Last solver update 0.3s ago");
  assert.equal(formatSolverUpdateAge(12000), "Last solver update 12s ago");
  assert.equal(formatSolverWork({}), null);
  assert.equal(formatSolverWork({ solverSearch: 1, solverStage: "Starting search", solverNodes: null }), "Search 1 · Starting search");
  assert.equal(formatSolverWork({ solverSearch: 2, solverStage: "Searching allocations", solverNodes: 0, solverIterations: 12345 }),
    "Search 2 · Searching allocations · 0 nodes · 12,345 LP iterations · counts for this search");
});
