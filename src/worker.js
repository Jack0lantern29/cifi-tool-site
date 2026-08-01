import { optimize, OptimizerValidationError } from "./optimizer.js?v=3.0.1";
import { optimizeCrazy } from "./crazy-optimizer.js?v=3.0.1";

self.addEventListener("message", async event => {
  const { type, requestId, input } = event.data || {};
  if (type !== "optimize" || !requestId) return;

  const startedAt = performance.now();
  let latestCheckpoint = null;
  try {
    const callbacks = {
      onProgress(progress) {
        self.postMessage({ type: "progress", requestId, progress });
      },
      onCheckpoint(result) {
        latestCheckpoint = result;
        self.postMessage({ type: "checkpoint", requestId, result: { ...result, durationMs: performance.now() - startedAt } });
      }
    };
    const result = input?.searchEffort === "crazy"
      ? await optimizeCrazy(input, callbacks)
      : optimize(input, callbacks);
    self.postMessage({
      type: "result",
      requestId,
      result: { ...result, durationMs: performance.now() - startedAt }
    });
  } catch (error) {
    if (input?.searchEffort === "crazy" && latestCheckpoint && !(error instanceof OptimizerValidationError)) {
      self.postMessage({
        type: "result",
        requestId,
        result: {
          ...latestCheckpoint,
          solutionStatus: "best-found",
          durationMs: performance.now() - startedAt,
          notices: [...(latestCheckpoint.notices || []), `Crazy solver stopped before proof: ${error?.message || "Unknown solver error."}`]
        }
      });
      return;
    }
    self.postMessage({
      type: "error",
      requestId,
      error: {
        name: error?.name || "Error",
        message: error?.message || "The optimiser failed.",
        errors: error instanceof OptimizerValidationError ? error.errors : []
      }
    });
  }
});
