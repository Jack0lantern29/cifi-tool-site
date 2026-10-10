import assert from "node:assert/strict";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { OptimizerWorkerClient } from "../src/worker-client.js";
import { createDefaultInput } from "../src/validation.js";

// Run the real background code in a Node worker for integration checks.
function workerFactory() {
  const entry = new URL("../src/worker.js", import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = {
      // Forward worker messages using the browser-style event format.
      addEventListener(type, listener) {
        parentPort.on(type, data => listener({ data }));
      },
      // Send a message to the other side of the worker connection.
      postMessage(data) { parentPort.postMessage(data); }
    };
    import(${JSON.stringify(entry)});
  `, { eval: true });
  return {
    // Forward worker messages using the browser-style event format.
    addEventListener(type, listener) {
      worker.on(type, data => listener(type === "message" ? { data } : data));
    },
    // Send a message to the other side of the worker connection.
    postMessage(data) { worker.postMessage(data); },
    // Stop the worker used by this test.
    terminate() { return worker.terminate(); }
  };
}

test("real Overkill worker loads WASM, completes, cancels with a checkpoint, and restarts", { timeout: 15000 }, async () => {
  const client = new OptimizerWorkerClient(workerFactory);
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.searchEffort = "crazy";
  input.mode = "Fragments";
  input.fragmentsPerCompletion = 0.001;
  input.selectedFarmMissions = ["F3-2", "F4-3"];
  input.workers["Mining Pod"] = { power: 1, count: 4 };
  try {
    const progress = [];
    const result = await client.run(input, { onProgress: event => progress.push(event) });
    assert.equal(result.solutionStatus, "tolerance-met");
    assert.ok(result.assignments.every(a => a.name === "F3-2"));
    assert.ok(progress.some(event => event.phase === "loading-solver"));
    assert.equal(progress.at(-1).phase, "complete");
    const activity = progress.filter(event => event.solverUpdate > 0);
    assert.ok(activity.length > 0, "real solver runs report activity even when logging is disabled");
    assert.ok(activity.some(event => event.solverNodes >= 0 && event.solverIterations >= 0));
    assert.ok(progress.some(event => event.solverStage === "Starting search"));
    const cancelled = await client.run(input, { onCheckpoint: () => client.cancel() });
    assert.equal(cancelled.solutionStatus, "cancelled-best");
    assert.ok(cancelled.assignments.length > 0);
    assert.equal(client.isRunning, false);
    const restarted = await client.run(input);
    assert.deepEqual(restarted.assignments, result.assignments);
    assert.equal(restarted.solutionStatus, "tolerance-met");
  } finally {
    client.dispose();
  }
});

test("numeric verification failure returns an explicitly unverified checkpoint", { timeout: 15000 }, async () => {
  const client = new OptimizerWorkerClient(workerFactory);
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.searchEffort = "crazy";
  input.mode = "Fragments";
  input.fragmentsPerCompletion = 0.001;
  input.selectedFarmMissions = ["F1-1", "F4-2"];
  input.workers["Mining Pod"] = { power: 1e20, count: 1 };
  input.workers["Fireteam Carrier"] = { power: 0.01, count: 2 };
  try {
    const result = await client.run(input);
    assert.equal(result.solutionStatus, "best-found");
    assert.ok(result.assignments.length > 0);
    assert.ok(result.notices.some(notice => notice.includes("numeric range")));
    assert.equal(result.objective.relativeGap, null);
    assert.equal(client.worker, null, "a failed solver is discarded before the next run");
    input.workers["Mining Pod"].power = 1;
    const recovered = await client.run(input);
    assert.equal(recovered.solutionStatus, "tolerance-met");
  } finally {
    client.dispose();
  }
});

test("reported all-farms Fragments setup completes with native work updates", { timeout: 30000 }, async () => {
  const client = new OptimizerWorkerClient(workerFactory);
  const input = createDefaultInput();
  Object.assign(input, { ouroUnlocked: true, searchEffort: "crazy", mode: "Fragments", fragmentsPerCompletion: 0.7974 });
  [[9.7, 29888], [17.8, 15666], [30, 6964], [51, 4105]].forEach(([power, count], index) => {
    input.workers[Object.keys(input.workers)[index]] = { power, count };
  });
  Object.assign(input.modifiers, {
    engineeringBadge: true, swarmLevel: 46, productivityLevel: 26,
    research58: 6, research80: 6, relic3: 55, ts07Enabled: true
  });
  try {
    const events = [];
    const result = await client.run(input, { onProgress: progress => events.push(progress) });
    assert.equal(result.solutionStatus, "tolerance-met");
    assert.ok(result.objective.relativeGap <= 0.000001);
    assert.ok(result.objective.primaryValue > 239296.57);
    assert.ok(events.some(event => event.solverUpdate > 0 && event.solverStage !== "Starting search" && event.solverStage !== "Checking search result"));
    assert.ok(events.some(event => event.solverNodes > 0));
    assert.ok(events.some(event => event.solverIterations > 0));
    const updates = events.filter(event => event.solverUpdate > 0);
    assert.ok(updates.every((event, index) => index === 0 || event.solverUpdate >= updates[index - 1].solverUpdate));
  } finally {
    client.dispose();
  }
});
