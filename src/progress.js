const PHASE_LABELS = Object.freeze({
  preparing: "Preparing…",
  "estimating-ideals": "Estimating hybrid ideals…",
  optimising: "Optimising farms…",
  polishing: "Polishing allocation…",
  campaign: "Assigning campaign remainder…",
  "shorts-planning": "Comparing campaign schedules…",
  "shorts-refining": "Refining campaign worker allocations…",
  "shorts-polishing": "Improving the overall campaign finish…",
  "shorts-away-check": "Checking concurrent crews before your return…",
  "loading-solver": "Loading Overkill solver…",
  "crazy-fragment-ideal": "Finding fragment ideal…",
  "crazy-resource-ideal": "Finding resource ideal…",
  "crazy-primary": "Optimising primary objective…",
  "crazy-tiebreak": "Optimising tie-break…",
  "crazy-utilisation": "Maximising personnel use…",
  cancelling: "Cancelling…",
  complete: "Completing…"
});

// Display elapsed time in seconds, minutes, and hours.
export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const totalSeconds = Math.floor(milliseconds / 1000);
  if (milliseconds > 0 && totalSeconds === 0) return "<1s";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// Format the number of search steps, or hide it when unavailable.
export function formatNodeCount(nodes) {
  if (!Number.isFinite(nodes) || nodes < 0) return null;
  return new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(Math.floor(nodes));
}

// Show how long it has been since the solver last reported real work.
export function formatSolverUpdateAge(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "No solver update yet";
  const age = milliseconds < 1000 ? `${(milliseconds / 1000).toFixed(1)}s` : formatDuration(milliseconds);
  return `Last solver update ${age} ago`;
}

// Label work counts for the current search, which reset for each new search.
export function formatSolverWork(progress) {
  if (!progress.solverSearch) return null;
  const details = [`Search ${progress.solverSearch}`, progress.solverStage];
  const nodes = formatNodeCount(progress.solverNodes);
  const iterations = formatNodeCount(progress.solverIterations);
  if (nodes !== null) details.push(`${nodes} nodes`);
  if (iterations !== null) details.push(`${iterations} LP iterations`);
  if (nodes !== null || iterations !== null) details.push("counts for this search");
  return details.filter(Boolean).join(" · ");
}

// Display the remaining accuracy gap as a percentage.
export function formatRelativeGap(relativeGap) {
  if (!Number.isFinite(relativeGap) || relativeGap < 0) return null;
  const percent = relativeGap * 100;
  if (percent > 0 && percent < 0.0001 * (1 - 1e-12)) return "<0.0001%";
  const maximumFractionDigits = percent < 0.01 ? 4 : 2;
  return `${new Intl.NumberFormat("en-AU", { maximumFractionDigits }).format(percent)}%`;
}

// Turn a progress update into labels and progress-bar values.
export function buildProgressView(progress = {}) {
  const phase = String(progress.phase || "");
  const basePhase = phase.replace(/^standard-/, "");
  const determinate = progress.determinate === true &&
    Number.isFinite(progress.total) && progress.total > 0 && Number.isFinite(progress.completed);
  const total = determinate ? Math.max(1, progress.total) : 1;
  const completed = determinate ? Math.min(total, Math.max(0, progress.completed)) : 0;
  return {
    phaseLabel: PHASE_LABELS[phase] || PHASE_LABELS[basePhase] || "Optimising…",
    determinate,
    total,
    completed,
    nodeText: formatNodeCount(progress.nodes),
    gapText: formatRelativeGap(progress.relativeGap)
  };
}
