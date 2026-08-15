export class OptimizerCancelledError extends Error {
  constructor() {
    super("Optimisation was cancelled.");
    this.name = "OptimizerCancelledError";
  }
}

export class OptimizerWorkerError extends Error {
  constructor(details = {}) {
    super(details.message || "The background optimiser failed.");
    this.name = details.name || "OptimizerWorkerError";
    this.errors = details.errors || [];
  }
}

export class OptimizerWorkerClient {
  constructor(workerFactory) {
    this.workerFactory = workerFactory;
    this.worker = null;
    this.active = null;
    this.sequence = 0;
  }

  get isRunning() {
    return Boolean(this.active);
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    this.worker = this.workerFactory();
    this.worker.addEventListener("message", event => this.handleMessage(event.data || {}));
    this.worker.addEventListener("error", () => this.fail(new OptimizerWorkerError({ message: "The background optimiser stopped unexpectedly." })));
    return this.worker;
  }

  run(input, { onProgress = () => {}, onCheckpoint = () => {} } = {}) {
    if (this.active) throw new Error("An optimisation is already running.");
    const requestId = `request-${++this.sequence}`;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.active = { requestId, resolve, reject, onProgress, onCheckpoint, latestCheckpoint: null, startedAt: performance.now() };
      worker.postMessage({ type: "optimize", requestId, input });
    });
  }

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
      resolve(message.result);
    } else if (message.type === "error") {
      this.fail(new OptimizerWorkerError(message.error));
    }
  }

  fail(error) {
    if (!this.active) return;
    const { reject } = this.active;
    this.active = null;
    reject(error);
    this.worker?.terminate();
    this.worker = null;
  }

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

  dispose() {
    if (this.active) this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
