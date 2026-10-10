// Track real solver updates without treating a page timer as solver activity.
export function createSolverProgress(onProgress, startedAt, now = () => performance.now()) {
  let lastSent = -Infinity;
  let update = 0;
  const tracker = {
    progress: {},
    // Start a search with fresh counters and no assumed activity.
    start(phase) {
      tracker.progress = {
        phase, determinate: false, completed: 0, total: 1,
        solverSearch: (tracker.progress.solverSearch || 0) + 1,
        solverStage: "Starting search", solverNodes: null, solverIterations: null,
        solverUpdate: update, relativeGap: null
      };
      lastSent = -Infinity;
      onProgress({ ...tracker.progress, elapsedMs: now() - startedAt });
    },
    // Share available work counts at most five times a second.
    report(data, stage, force = false) {
      const time = now();
      const progress = tracker.progress;
      for (const [field, value] of [
        ["solverNodes", data.mip_node_count],
        ["solverIterations", data.mip_total_lp_iterations]
      ]) {
        if (value != null && Number.isFinite(Number(value)) && Number(value) >= 0) {
          progress[field] = Number(value);
        }
      }
      if (data.mip_gap !== undefined) progress.relativeGap = data.mip_gap;
      if (!force && time - lastSent < 200) return;
      lastSent = time;
      progress.solverStage = stage;
      progress.solverUpdate = ++update;
      onProgress({ ...progress, elapsedMs: time - startedAt });
    }
  };
  return tracker;
}
