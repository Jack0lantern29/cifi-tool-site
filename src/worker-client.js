export class OptimizerCancelledError extends Error {
  // Create the error used when a run stops before producing a result.
  constructor() {
    super("Optimisation was cancelled.");
    this.name = "OptimizerCancelledError";
  }
}

export class OptimizerWorkerError extends Error {
  // Keep the worker's error message and any input problems together.
  constructor(details = {}) {
    super(details.message || "The background optimiser failed.");
    this.name = details.name || "OptimizerWorkerError";
    this.errors = details.errors || [];
  }
}

export class OptimizerWorkerClient {
  // Prepare the worker connection and active-run tracking.
  constructor(workerFactory) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.active = null;
    this.sequence = 0;
  }

  // Report whether a search is currently active.
  get isRunning() {
    return Boolean(this.active);
  }

  // Start the background worker if one is not already available.
  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = this.workerFactory();
    this.worker = worker;
    worker.addEventListener("message", event => {
      if (this.worker === worker) this.handleMessage(event.data || {});
    });
    worker.addEventListener("error", () => {
      if (this.worker === worker) this.fail(new OptimizerWorkerError({ message: "The background optimiser stopped unexpectedly." }));
    });
    return this.worker;
  }

  // Send settings to the worker and wait for the result.
  run(input, { onProgress = () => {}, onCheckpoint = () => {} } = {}) {
    if (this.active) throw new Error("An optimisation is already running.");
    const requestId = `request-${++this.sequence}`;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.active = { requestId, resolve, reject, onProgress, onCheckpoint, latestCheckpoint: null, startedAt: performance.now() };
      worker.postMessage({ type: "optimize", requestId, input });
    });
  }

  // Route worker updates to progress, checkpoints, results, or errors.
  handleMessage(message) {
    if (!this.active || message.requestId !== this.active.requestId) return;
    if (message.type === "progress") {
      this.active.onProgress(message.progress);
      return;
    }
    if (message.type === "checkpoint") {
      this.active.latestCheckpoint = message.result;
      this.active.onCheckpoint(message.result);
      return;
    }
    if (message.type === "result") {
      const { resolve } = this.active;
      this.active = null;
      if (message.resetWorker) {
        this.worker?.terminate();
        this.worker = null;
      }
      resolve(message.result);
    } else if (message.type === "error") {
      this.fail(new OptimizerWorkerError(message.error));
    }
  }

  // Reject the active run and stop the failed worker.
  fail(error) {
    if (!this.active) return;
    const { reject } = this.active;
    this.active = null;
    reject(error);
    this.worker?.terminate();
    this.worker = null;
  }

  // Stop the run and return its latest complete allocation when available.
  cancel() {
    if (!this.active) return false;
    const { resolve, reject, latestCheckpoint, startedAt } = this.active;
    this.active = null;
    this.worker?.terminate();
    this.worker = null;
    if (latestCheckpoint) {
      const notice = "Overkill was cancelled; this is the best complete allocation found before cancellation.";
      resolve({
        ...latestCheckpoint,
        solutionStatus: "cancelled-best",
        durationMs: performance.now() - startedAt,
        notices: [...(latestCheckpoint.notices || []).filter(item => item !== notice), notice]
      });
    } else {
      reject(new OptimizerCancelledError());
    }
    return true;
  }

  // Cancel any active run and release the worker.
  dispose() {
    if (this.active) this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
