import assert from "node:assert/strict";
import test from "node:test";

import { OptimizerCancelledError, OptimizerWorkerClient } from "../src/worker-client.js";

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emitMessage(message) {
    this.listeners.get("message")?.({ data: message });
  }

  terminate() {
    this.terminated = true;
  }
}

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
