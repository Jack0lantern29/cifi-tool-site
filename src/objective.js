import { MATS } from "./data.js?v=3.2.8";

export const OBJECTIVE_EPSILON = 1e-9;
// Overkill stops once the incumbent is certified within 0.0001% of the best bound.
export const PROOF_RELATIVE_GAP = 1e-6;

// Convert a mode name into the score category used by the optimiser.
export function getModeKind(mode) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "maximising resources") return "resources";
  if (normalized === "academy points") return "academy";
  if (normalized === "max completions") return "completions";
  if (["farm fragments", "fragments farm", "fragments", "fragments farming"].includes(normalized)) return "fragments";
  if (["fragments + resources", "fragments and resources", "fragment/resource hybrid", "hybrid fragments/resources"].includes(normalized)) return "hybrid";
  return "completions";
}

// Score resource totals using priorities and diminishing returns.
export function resourceUtilityFromTotals(totals, weights) {
  return MATS.reduce((sum, material) => {
    const value = Math.max(0, Number(totals?.[material]) || 0);
    return sum + (weights?.[material] || 1) * Math.log1p(value);
  }, 0);
}

// Collect the main scores used to compare allocations.
export function summaryFromTotals(totals, weights) {
  return {
    resourceUtility: resourceUtilityFromTotals(totals, weights),
    fragments: Math.max(0, Number(totals?.Fragments) || 0),
    academy: Math.max(0, Number(totals?.Academy) || 0),
    completions: Math.max(0, Number(totals?.Completions) || 0)
  };
}

// Balance fragments and resources against their separate best scores.
export function normalizedHybridScore(summary, ideals) {
  const fragmentIdeal = Math.max(0, Number(ideals?.fragments) || 0);
  const resourceIdeal = Math.max(0, Number(ideals?.resourceUtility) || 0);
  const configuredFragmentWeight = Number(ideals?.fragmentWeight);
  const fragmentWeight = Number.isFinite(configuredFragmentWeight)
    ? Math.min(1, Math.max(0, configuredFragmentWeight))
    : 0.75;
  const resourceWeight = 1 - fragmentWeight;
  if (fragmentIdeal === 0 && resourceIdeal === 0) return summary.completions;
  if (fragmentIdeal === 0) return summary.resourceUtility / resourceIdeal;
  if (resourceIdeal === 0) return summary.fragments / fragmentIdeal;
  return fragmentWeight * (summary.fragments / fragmentIdeal) + resourceWeight * (summary.resourceUtility / resourceIdeal);
}

// Compare two numbers while allowing a small rounding difference.
function compareNumber(a, b, epsilon) {
  const tolerance = epsilon * Math.max(Math.abs(a), Math.abs(b));
  if (a > b + tolerance) return 1;
  if (a < b - tolerance) return -1;
  return 0;
}

// Compare the main score first, then use the secondary score to break ties.
export function compareSummaries(mode, candidate, incumbent, ideals = null, epsilon = OBJECTIVE_EPSILON) {
  if (!incumbent) return 1;
  const kind = getModeKind(mode);
  let primaryCandidate;
  let primaryIncumbent;
  let secondaryCandidate;
  let secondaryIncumbent;

  if (kind === "resources") {
    primaryCandidate = candidate.resourceUtility;
    primaryIncumbent = incumbent.resourceUtility;
    secondaryCandidate = candidate.fragments;
    secondaryIncumbent = incumbent.fragments;
  } else if (kind === "academy") {
    primaryCandidate = candidate.academy;
    primaryIncumbent = incumbent.academy;
    secondaryCandidate = candidate.completions;
    secondaryIncumbent = incumbent.completions;
  } else if (kind === "completions") {
    primaryCandidate = candidate.completions;
    primaryIncumbent = incumbent.completions;
    secondaryCandidate = candidate.fragments;
    secondaryIncumbent = incumbent.fragments;
  } else if (kind === "fragments") {
    primaryCandidate = candidate.fragments;
    primaryIncumbent = incumbent.fragments;
    secondaryCandidate = candidate.resourceUtility;
    secondaryIncumbent = incumbent.resourceUtility;
  } else {
    primaryCandidate = normalizedHybridScore(candidate, ideals);
    primaryIncumbent = normalizedHybridScore(incumbent, ideals);
    secondaryCandidate = candidate.completions;
    secondaryIncumbent = incumbent.completions;
  }

  return compareNumber(primaryCandidate, primaryIncumbent, epsilon) ||
    compareNumber(secondaryCandidate, secondaryIncumbent, epsilon);
}

// Attach readable names to the selected mode's scores.
export function describeObjective(mode, summary, ideals = null) {
  const kind = getModeKind(mode);
  if (kind === "resources") return { primaryName: "Resource utility", primaryValue: summary.resourceUtility, secondaryName: "Fragments", secondaryValue: summary.fragments };
  if (kind === "academy") return { primaryName: "Academy points", primaryValue: summary.academy, secondaryName: "Completions", secondaryValue: summary.completions };
  if (kind === "completions") return { primaryName: "Completions", primaryValue: summary.completions, secondaryName: "Fragments", secondaryValue: summary.fragments };
  if (kind === "fragments") return { primaryName: "Fragments", primaryValue: summary.fragments, secondaryName: "Resource utility", secondaryValue: summary.resourceUtility };
  return { primaryName: "Hybrid score", primaryValue: normalizedHybridScore(summary, ideals), secondaryName: "Completions", secondaryValue: summary.completions };
}

// Measure how far a score could be from the best possible result.
export function relativeGap(incumbent, bound) {
  if (!Number.isFinite(incumbent) || !Number.isFinite(bound)) return null;
  if (bound < incumbent - 1e-9 * Math.abs(incumbent)) return null;
  if (incumbent === 0) return bound === 0 ? 0 : null;
  return Math.max(0, bound - incumbent) / Math.abs(incumbent);
}
