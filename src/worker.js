import { optimize, OptimizerValidationError } from "./optimizer.js?v=3.2.6";
import { optimizeCrazy } from "./crazy-optimizer.js?v=3.2.6";
import { optimizeShorts } from "./shorts-optimizer.js?v=3.2.6";

// Run search requests and send progress, results, or errors back to the page.
self.addEventListener("message", async event => {
  const { type, requestId, input, reservedFarms = [], plannedAt = Date.now() } = event.data || {};
  if (type !== "optimize" || !requestId) return;

  const startedAt = performance.now();
  let latestCheckpoint = null;
  try {
    const callbacks = {
      reservedFarms,
      plannedAt,
      // Send the latest search progress to the page.
      onProgress(progress) {
        self.postMessage({ type: "progress", requestId, progress });
      },
      // Keep and send a complete allocation in case the search stops.
      onCheckpoint(result) {
        latestCheckpoint = result;
        self.postMessage({ type: "checkpoint", requestId, result: { ...result, durationMs: performance.now() - startedAt } });
      }
    };
    const result = input?.campaignEnabled && input?.shortsEnabled
      ? await optimizeShorts(input, callbacks)
      : input?.searchEffort === "crazy"
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
        resetWorker: true,
        result: {
          ...latestCheckpoint,
          solutionStatus: "best-found",
          durationMs: performance.now() - startedAt,
          notices: [...(latestCheckpoint.notices || []), `Overkill stopped before reaching its target: ${error?.message || "Unknown solver error."}`]
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
