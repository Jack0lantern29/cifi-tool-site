import assert from "node:assert/strict";
import test from "node:test";

import { OptimizerCancelledError, OptimizerWorkerClient } from "../src/worker-client.js";

class FakeWorker {
  // Set up a fake worker to test messages and cancellation.
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
  }

  // Store a listener for a simulated worker event.
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  // Record a request sent to the fake worker.
  postMessage(message) {
    this.messages.push(message);
  }

  // Deliver a simulated worker reply to the client.
  emitMessage(message) {
    this.listeners.get("message")?.({ data: message });
  }

  // Record that the fake worker was stopped.
  terminate() {
    this.terminated = true;
  }
}

test("a solver failure preserves its result and starts the next run in a fresh worker", async () => {
  const workers = [];
  const client = new OptimizerWorkerClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const run = client.run({});
  const result = { solutionStatus: "best-found", assignments: [], notices: ["Aborted()"] };
  workers[0].emitMessage({ type: "result", requestId: workers[0].messages[0].requestId, resetWorker: true, result });
  assert.deepEqual(await run, result);
  assert.equal(workers[0].terminated, true);
  const next = client.run({});
  assert.equal(workers.length, 2);
  workers[0].listeners.get("error")();
  workers[0].emitMessage({ type: "result", requestId: workers[0].messages[0].requestId, result });
  assert.equal(client.isRunning, true);
  workers[1].emitMessage({ type: "result", requestId: workers[1].messages[0].requestId, result: { solutionStatus: "tolerance-met" } });
  assert.equal((await next).solutionStatus, "tolerance-met");
  client.dispose();
});

test("cancelling before a checkpoint rejects and terminates the worker", async () => {
  const worker = new FakeWorker();
  const client = new OptimizerWorkerClient(() => worker);
  const run = client.run({});

  assert.equal(client.cancel(), true);
  await assert.rejects(run, OptimizerCancelledError);
  assert.equal(worker.terminated, true);
  assert.equal(client.isRunning, false);
});

test("cancelling after a checkpoint resolves with the best complete result", async () => {
  const worker = new FakeWorker();
  const client = new OptimizerWorkerClient(() => worker);
  const run = client.run({});
  const requestId = worker.messages[0].requestId;

  worker.emitMessage({
    type: "checkpoint",
    requestId,
    result: { assignments: [], notices: [], solutionStatus: "best-found" }
  });
  assert.equal(client.cancel(), true);

  const result = await run;
  assert.equal(result.solutionStatus, "cancelled-best");
  assert.match(result.notices.at(-1), /cancelled/i);
  assert.equal(worker.terminated, true);
  assert.equal(client.isRunning, false);
});
