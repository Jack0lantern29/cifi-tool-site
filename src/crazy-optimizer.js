import {
  CAMPAIGN_BASE_CAPS,
  getFx4FragmentBonusMultiplier,
  MATS,
  MISSION_DATA,
  OURO_OFF_VISIBLE_FARMS,
  TYPE_ORDER,
  TYPE_RANK
} from "./data.js?v=3.0.3";
import {
  compareSummaries,
  describeObjective,
  getModeKind,
  normalizedHybridScore,
  PROOF_RELATIVE_GAP,
  relativeGap,
  summaryFromTotals
} from "./objective.js?v=3.0.3";
import { optimize, OptimizerValidationError } from "./optimizer.js?v=3.0.3";
import { deriveSeed, formatRunId } from "./random.js?v=3.0.3";
import { calculateGlobalSpeedMultiplier, validateInput } from "./validation.js?v=3.0.3";
import { createSolverProgress } from "./solver-progress.js?v=3.0.3";
import { buildProgressView } from "./progress.js?v=3.0.3";

const MAX_RUNS_PER_HOUR = 1800;
const NUMERIC_EPSILON = 1e-9;
const SOLVE_RELATIVE_GAP = PROOF_RELATIVE_GAP / 100;
const BOUND_ROUNDOFF = 1e-9;
const SOLVER_PACKAGE_VERSION = "1.15.3-pre.4";

let highsPromise;
const solverDiagnostics = [];

// Keep a small amount of solver error output to explain unexpected failures.
function recordSolverDiagnostic_(message) {
  solverDiagnostics.push(String(message).slice(0, 500));
  if (solverDiagnostics.length > 8) solverDiagnostics.shift();
}

// Load the Overkill solver once and reuse it for later runs.
async function loadSolver_() {
  if (!highsPromise) {
    highsPromise = import("../vendor/highs/highs.mjs?v=3.0.3").then(({ default: loadHighs }) => loadHighs({
      locateFile: file => file.endsWith(".wasm")
        ? new URL("../vendor/highs/highs.wasm?v=3.0.3", import.meta.url).href
        : file,
      print: () => {},
      printErr: recordSolverDiagnostic_
    }));
  }
  return highsPromise;
}

// Prepare the selected farms, available personnel, and active bonuses.
function buildContext_(input) {
  const selected = new Set(input.campaignEnabled ? input.selectedCampaignFarmMissions : input.selectedFarmMissions);
  const speed = calculateGlobalSpeedMultiplier(input);
  const tsMultiplier = input.modifiers.ts07Enabled ? 2 : 1;
  const missions = MISSION_DATA.filter(row => {
    if (!row.name.startsWith("F") || !selected.has(row.name)) return false;
    return input.ouroUnlocked || OURO_OFF_VISIBLE_FARMS.has(row.name);
  }).map(row => ({
    ...row,
    alpha: 60 * speed / row.minutes,
    fragmentYield: input.fragmentsPerCompletion * (1 + getFx4FragmentBonusMultiplier(row.name))
  }));
  const workers = TYPE_ORDER.filter(type => input.workers[type].count > 0 && input.workers[type].power > 0)
    .map(type => ({ type, ...input.workers[type] }));
  return { input, missions, workers, speed, tsMultiplier };
}

// Create a reward total with every value starting at zero.
function emptyTotals_() {
  const totals = { Academy: 0, Completions: 0, Fragments: 0 };
  MATS.forEach(material => { totals[material] = 0; });
  return totals;
}

// Calculate hourly rewards and scores for a farm allocation.
function evaluateFarmAssignments_(context, farmAssignments) {
  const totals = emptyTotals_();
  const byMission = new Map(context.missions.map(mission => [mission.name, { mission, power: 0, units: 0 }]));
  farmAssignments.forEach(({ name, type, count }) => {
    const entry = byMission.get(name);
    if (!entry || count <= 0) return;
    entry.power += context.input.workers[type].power * count;
    entry.units += count;
  });
  byMission.forEach(({ mission, power }) => {
    if (power <= 0) return;
    const runs = Math.min(MAX_RUNS_PER_HOUR, mission.alpha * power);
    totals.Completions += runs * context.tsMultiplier;
    totals.Academy += runs * context.tsMultiplier * mission.academy;
    totals.Fragments += runs * mission.fragmentYield;
    MATS.forEach(material => {
      totals[material] += runs * context.tsMultiplier * mission.rewards[material];
    });
  });
  return { totals, summary: summaryFromTotals(totals, context.input.weights) };
}

// Calculate the campaign's personnel limit after relic bonuses.
function effectiveCampaignCap_(input) {
  if (!input.campaignEnabled) return 0;
  const base = CAMPAIGN_BASE_CAPS[input.campaignTargetName] || 0;
  const relicMultiplier = input.ouroUnlocked ? 1 + input.relic11Level * 0.5 : 1;
  return Math.round(base * relicMultiplier);
}

// Free personnel whose removal leaves farm output unchanged.
function removeRedundantCappedAssignments_(context, farmAssignments) {
  const counts = new Map();
  farmAssignments.forEach(({ name, type, count }) => {
    if (count <= 0) return;
    const key = `${name}|${type}`;
    counts.set(key, (counts.get(key) || 0) + count);
  });

  context.missions.forEach(mission => {
    let power = context.workers.reduce((sum, worker) =>
      sum + (counts.get(`${mission.name}|${worker.type}`) || 0) * worker.power, 0);
    const originalRuns = Math.min(MAX_RUNS_PER_HOUR, mission.alpha * power);
    if (originalRuns < MAX_RUNS_PER_HOUR) return;
    const requiredPower = MAX_RUNS_PER_HOUR / mission.alpha;

    for (let typeIndex = TYPE_ORDER.length - 1; typeIndex >= 0; typeIndex--) {
      const type = TYPE_ORDER[typeIndex];
      const workerPower = context.input.workers[type].power;
      const key = `${mission.name}|${type}`;
      const existing = counts.get(key) || 0;
      if (existing <= 0 || workerPower <= 0) continue;
      const removable = Math.min(existing, Math.max(0, Math.floor((power - requiredPower) / workerPower)));
      const count = existing - removable;
      power -= removable * workerPower;
      if (count > 0) counts.set(key, count);
      else counts.delete(key);
    }
  });

  return [...counts].map(([key, count]) => {
    const separator = key.lastIndexOf("|");
    return { name: key.slice(0, separator), type: key.slice(separator + 1), count };
  });
}

// Place spare personnel wherever they can still improve the score.
function redistributeBeneficialRemainder_(context, farmAssignments, hybridIdeals) {
  const counts = new Map();
  const missionState = new Map(context.missions.map(mission => [mission.name, { mission, units: 0, power: 0 }]));
  const usedByType = Object.fromEntries(TYPE_ORDER.map(type => [type, 0]));
  farmAssignments.forEach(({ name, type, count }) => {
    if (count <= 0 || !missionState.has(name)) return;
    const key = `${name}|${type}`;
    counts.set(key, (counts.get(key) || 0) + count);
    missionState.get(name).units += count;
    missionState.get(name).power += context.input.workers[type].power * count;
    usedByType[type] += count;
  });

  const evaluated = evaluateFarmAssignments_(context, farmAssignments);
  let currentTotals = evaluated.totals;
  let currentSummary = evaluated.summary;
  const remainingByType = Object.fromEntries(context.workers.map(worker => [
    worker.type,
    Math.max(0, worker.count - usedByType[worker.type])
  ]));
  let openSlots = context.missions.reduce((sum, mission) =>
    sum + Math.max(0, mission.cap - missionState.get(mission.name).units), 0);
  while (openSlots > 0 && context.workers.some(worker => remainingByType[worker.type] > 0)) {
    let bestWorker = null;
    let bestState = null;
    let bestTotals = null;
    let bestSummary = null;
    context.workers.forEach(worker => {
      if (remainingByType[worker.type] <= 0) return;
      context.missions.forEach(mission => {
        const state = missionState.get(mission.name);
        if (state.units >= mission.cap) return;
        const oldRuns = Math.min(MAX_RUNS_PER_HOUR, mission.alpha * state.power);
        const newRuns = Math.min(MAX_RUNS_PER_HOUR, mission.alpha * (state.power + worker.power));
        const deltaRuns = newRuns - oldRuns;
        if (deltaRuns <= 0) return;
        const candidateTotals = { ...currentTotals };
        candidateTotals.Completions += deltaRuns * context.tsMultiplier;
        candidateTotals.Academy += deltaRuns * context.tsMultiplier * mission.academy;
        candidateTotals.Fragments += deltaRuns * mission.fragmentYield;
        MATS.forEach(material => {
          candidateTotals[material] += deltaRuns * context.tsMultiplier * mission.rewards[material];
        });
        const candidateSummary = summaryFromTotals(candidateTotals, context.input.weights);
        if (compareSummaries(context.input.mode, candidateSummary, currentSummary, hybridIdeals, 0) <= 0) return;
        if (bestSummary && compareSummaries(context.input.mode, candidateSummary, bestSummary, hybridIdeals, 0) <= 0) return;
        bestState = state;
        bestTotals = candidateTotals;
        bestSummary = candidateSummary;
        bestWorker = worker;
      });
    });
    if (!bestState || !bestWorker) break;
    const key = `${bestState.mission.name}|${bestWorker.type}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    bestState.units++;
    bestState.power += bestWorker.power;
    remainingByType[bestWorker.type]--;
    openSlots--;
    currentTotals = bestTotals;
    currentSummary = bestSummary;
  }

  return [...counts].map(([key, count]) => {
    const separator = key.lastIndexOf("|");
    return { name: key.slice(0, separator), type: key.slice(separator + 1), count };
  });
}

// Free unnecessary personnel and give them useful farm work.
function rebalanceFarmAssignments_(context, farmAssignments, hybridIdeals) {
  return redistributeBeneficialRemainder_(
    context,
    removeRedundantCappedAssignments_(context, farmAssignments),
    hybridIdeals
  );
}

// Check that assignments use whole counts and stay within all limits.
function validateFarmAssignments_(context, assignments) {
  const counts = new Map();
  const units = new Map();
  for (const { name, type, count } of assignments) {
    const mission = context.missions.find(candidate => candidate.name === name);
    const worker = context.workers.find(candidate => candidate.type === type);
    if (!mission || !worker || !Number.isSafeInteger(count) || count < 0) {
      throw new Error("The solver returned an invalid personnel allocation.");
    }
    counts.set(type, (counts.get(type) || 0) + count);
    units.set(name, (units.get(name) || 0) + count);
    if (counts.get(type) > worker.count || units.get(name) > mission.cap) {
      throw new Error("The solver allocation exceeds available personnel or mission capacity.");
    }
  }
}

// Check whether the score is close enough to a trustworthy upper limit.
function certifyBound_(value, bound, tolerance = PROOF_RELATIVE_GAP) {
  if (!Number.isFinite(value) || !Number.isFinite(bound) || value < 0 || bound < 0) return null;
  const magnitude = Math.max(value, bound);
  if (value - bound > BOUND_ROUNDOFF * magnitude) return null;
  const upperBound = magnitude * (1 + BOUND_ROUNDOFF);
  const gap = relativeGap(value, upperBound);
  return gap != null && gap <= tolerance ? { upperBound, relativeGap: gap } : null;
}

// Allow for uncertainty in hybrid benchmarks when checking accuracy.
function conservativePrimary_(mode, summary, ideals) {
  if (getModeKind(mode) !== "hybrid" || !ideals?.proven) return describeObjective(mode, summary, ideals).primaryValue;
  return normalizedHybridScore(summary, {
    ...ideals,
    fragments: ideals.fragmentUpperBound ?? ideals.fragments,
    resourceUtility: ideals.resourceUpperBound ?? ideals.resourceUtility
  });
}

// Finish farm allocation, assign the campaign remainder, and check the result.
function finalizeResult_(context, farmAssignments, metadata) {
  const { input } = context;
  validateFarmAssignments_(context, farmAssignments);
  const finalFarmAssignments = rebalanceFarmAssignments_(context, farmAssignments, metadata.hybridIdeals);
  validateFarmAssignments_(context, finalFarmAssignments);
  const { totals, summary } = evaluateFarmAssignments_(context, finalFarmAssignments);
  const remaining = Object.fromEntries(TYPE_ORDER.map(type => [type, input.workers[type].count]));
  finalFarmAssignments.forEach(({ type, count }) => { remaining[type] -= count; });

  const assignments = finalFarmAssignments.map(assignment => ({ ...assignment }));
  const campaignCapacity = effectiveCampaignCap_(input);
  let campaignAssigned = 0;
  let campaignPower = 0;
  if (input.campaignEnabled && campaignCapacity > 0) {
    [...TYPE_ORDER].sort((a, b) => input.workers[b].power - input.workers[a].power || TYPE_RANK[a] - TYPE_RANK[b]).forEach(type => {
      if (campaignAssigned >= campaignCapacity || input.workers[type].power <= 0) return;
      const count = Math.min(remaining[type], campaignCapacity - campaignAssigned);
      if (count <= 0) return;
      assignments.push({ name: input.campaignTargetName, type, count });
      remaining[type] -= count;
      campaignAssigned += count;
      campaignPower += count * input.workers[type].power;
    });
  }

  assignments.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) ||
    (TYPE_RANK[a.type] || 99) - (TYPE_RANK[b.type] || 99));
  let campaignETA = Infinity;
  if (input.campaignEnabled && campaignPower > 0) {
    const target = MISSION_DATA.find(mission => mission.name === input.campaignTargetName);
    const minutes = Math.max(target.minutes / (context.speed * campaignPower), 2 / 60);
    campaignETA = minutes / 60;
  }

  const objectiveBase = describeObjective(input.mode, summary, metadata.hybridIdeals);
  const conservativeValue = conservativePrimary_(input.mode, summary, metadata.hybridIdeals);
  const certificate = certifyBound_(conservativeValue, metadata.upperBound);
  const claimsProof = metadata.solutionStatus === "tolerance-met" || metadata.solutionStatus === "optimal";
  const solutionStatus = claimsProof && !certificate ? "best-found" : metadata.solutionStatus;
  const notices = [];
  if (claimsProof && !certificate) notices.push("Best allocation found; the requested optimality tolerance could not be verified.");
  if (context.missions.length === 0) notices.push("No farm missions were selected for this run.");
  if (input.campaignEnabled && campaignAssigned >= campaignCapacity && Object.values(remaining).some(count => count > 0)) {
    notices.push("Campaign capacity was reached; some personnel remain unassigned.");
  }
  if (assignments.length === 0) notices.push("No personnel could be assigned with the current inputs.");
  if (metadata.solutionStatus === "cancelled-best") notices.push("Overkill was cancelled; this is the best complete allocation found before cancellation.");

  return {
    assignments,
    totals,
    campaignETA,
    campaignCapacity,
    campaignAssigned,
    selectedFarmCount: context.missions.length,
    selectedFarmNames: context.missions.map(mission => mission.name),
    unassignedWorkers: remaining,
    globalSpeedMult: context.speed,
    modeUsed: input.mode,
    searchEffort: "crazy",
    solutionStatus,
    objective: {
      ...objectiveBase,
      upperBound: certificate?.upperBound ?? (Number.isFinite(metadata.upperBound) ? metadata.upperBound : null),
      relativeGap: certificate?.relativeGap ?? relativeGap(conservativeValue, metadata.upperBound)
    },
    solverStats: metadata.solverStats,
    hybridIdeals: metadata.hybridIdeals || null,
    seed: metadata.seed,
    runId: formatRunId(metadata.seed),
    notices
  };
}

// Extract farm assignments from a completed result.
function farmAssignmentsFromResult_(result) {
  return result.assignments.filter(assignment => assignment.name.startsWith("F"));
}

// Rescale a solver rule so very small values remain meaningful.
function scaledRow_(entries, lower, upper, scales, infinity) {
  const combined = new Map();
  entries.forEach(([index, value]) => {
    combined.set(index, (combined.get(index) || 0) + value * scales[index]);
  });
  const nonzero = [...combined].filter(([, value]) => value !== 0);
  const magnitude = Math.max(...nonzero.map(([, value]) => Math.abs(value)), 0) || 1;
  if (!Number.isFinite(magnitude) || nonzero.some(([, value]) => Math.abs(value / magnitude) <= 1e-12)) {
    throw new Error("The inputs span too large a numeric range to verify an optimal allocation.");
  }
  return {
    entries: nonzero.map(([index, value]) => [index, value / magnitude]),
    lower: lower <= -infinity ? -infinity : lower / magnitude,
    upper: upper >= infinity ? infinity : upper / magnitude
  };
}

class ModelBuilder_ {
  // Start an empty collection of solver choices and rules.
  constructor(highs) {
    this.highs = highs;
    this.columns = [];
    this.rows = [];
  }

  // Add one quantity the solver can choose, with its limits and score.
  addColumn(name, lower, upper, cost = 0, integer = false) {
    const index = this.columns.length;
    this.columns.push({ name, lower, upper, cost, integer });
    return index;
  }

  // Add a rule that limits combinations of solver choices.
  addRow(entries, lower, upper) {
    const combined = new Map();
    entries.forEach(([index, value]) => {
      if (value === 0) return;
      combined.set(index, (combined.get(index) || 0) + value);
    });
    this.rows.push({ entries: [...combined.entries()].filter(([, value]) => value !== 0), lower, upper });
  }

  // Scale and package the choices and rules for the solver.
  build() {
    this.scales = this.columns.map(column => !column.integer && column.upper > 0 ? column.upper : 1);
    const objectiveRange = this.columns.reduce((sum, column) => sum + Math.abs(column.cost * column.upper), 0);
    this.objectiveScale = objectiveRange > 0 ? 10000 / objectiveRange : 1;
    if (!Number.isFinite(this.objectiveScale) || this.scales.some(scale => !Number.isFinite(scale))) {
      throw new Error("The inputs exceed the solver's numeric range.");
    }
    const rows = this.rows.map(row => scaledRow_(row.entries, row.lower, row.upper, this.scales, this.highs.infinity));
    const starts = [0];
    const indices = [];
    const values = [];
    rows.forEach(row => {
      row.entries.sort((a, b) => a[0] - b[0]).forEach(([index, value]) => {
        indices.push(index);
        values.push(value);
      });
      starts.push(indices.length);
    });
    return {
      numCols: this.columns.length,
      numRows: this.rows.length,
      sense: this.highs.constants.objectiveSense.maximize,
      colCost: this.columns.map((column, index) => column.cost * this.scales[index] * this.objectiveScale),
      colLower: this.columns.map((column, index) => column.lower / this.scales[index]),
      colUpper: this.columns.map((column, index) => column.upper / this.scales[index]),
      rowLower: rows.map(row => row.lower),
      rowUpper: rows.map(row => row.upper),
      matrix: { format: "csr", numRows: this.rows.length, numCols: this.columns.length, starts, indices, values },
      integrality: this.columns.map(column => column.integer
        ? this.highs.constants.variableType.integer
        : this.highs.constants.variableType.continuous),
      colNames: this.columns.map(column => column.name)
    };
  }
}

// Find the most power this mission could hold with available personnel.
function maximumMissionPower_(context, mission) {
  let slots = mission.cap;
  let power = 0;
  [...context.workers].sort((a, b) => b.power - a.power || TYPE_RANK[a.type] - TYPE_RANK[b.type]).forEach(worker => {
    if (slots <= 0) return;
    const count = Math.min(slots, worker.count);
    power += count * worker.power;
    slots -= count;
  });
  return power;
}

// Find the highest possible hourly runs for one mission.
function missionRunUpperBound_(context, mission) {
  return Math.min(MAX_RUNS_PER_HOUR, mission.alpha * maximumMissionPower_(context, mission));
}

// Limit each personnel type to the most that could help this mission.
function workerMissionUpperBound_(mission, worker) {
  const usefulToReachFloor = Math.max(1, Math.ceil(MAX_RUNS_PER_HOUR / (mission.alpha * worker.power) - NUMERIC_EPSILON));
  return Math.min(worker.count, mission.cap, usefulToReachFloor);
}

// Calculate safe upper limits for each resource's hourly output.
function maxResourceTotals_(context) {
  return Object.fromEntries(MATS.map(material => [material,
    context.tsMultiplier * context.missions.reduce((sum, mission) =>
      sum + missionRunUpperBound_(context, mission) * mission.rewards[material], 0)
  ]));
}

// Build a straight-line upper estimate of the resource score.
export function logarithmTangent(value, weight = 1) {
  const point = Math.max(0, value);
  const slope = weight / (point + 1);
  return { slope, intercept: weight * Math.log1p(point) - slope * point };
}

// Turn personnel limits, mission rewards, and score targets into solver rules.
function buildModel_(highs, context, specification) {
  const builder = new ModelBuilder_(highs);
  const x = new Map();
  context.missions.forEach((mission, missionIndex) => {
    context.workers.forEach(worker => {
      const index = builder.addColumn(`x_${missionIndex}_${TYPE_RANK[worker.type]}`, 0, workerMissionUpperBound_(mission, worker), 0, true);
      x.set(`${mission.name}|${worker.type}`, index);
    });
  });
  const runs = context.missions.map((mission, index) => builder.addColumn(
    `runs_${index}`,
    0,
    missionRunUpperBound_(context, mission),
    specification.runCosts?.[mission.name] || 0,
    false
  ));
  const utility = {};
  const maximumTotals = maxResourceTotals_(context);
  if (specification.utilityFactor > 0) {
    MATS.forEach(material => {
      const upper = context.input.weights[material] * Math.log1p(maximumTotals[material]);
      utility[material] = builder.addColumn(`utility_${material}`, 0, Math.max(0, upper), specification.utilityFactor, false);
    });
  }

  context.workers.forEach(worker => {
    builder.addRow(context.missions.map(mission => [x.get(`${mission.name}|${worker.type}`), 1]), -highs.infinity, worker.count);
  });
  context.missions.forEach((mission, missionIndex) => {
    builder.addRow(context.workers.map(worker => [x.get(`${mission.name}|${worker.type}`), 1]), -highs.infinity, mission.cap);
    const powerEntries = [[runs[missionIndex], 1]];
    context.workers.forEach(worker => powerEntries.push([x.get(`${mission.name}|${worker.type}`), -mission.alpha * worker.power]));
    builder.addRow(powerEntries, -highs.infinity, 0);
    if (missionRunUpperBound_(context, mission) >= MAX_RUNS_PER_HOUR - NUMERIC_EPSILON) {
      const requiredPower = MAX_RUNS_PER_HOUR / mission.alpha;
      const largestWorkerPower = Math.max(...context.workers.map(worker => worker.power));
      builder.addRow(
        context.workers.map(worker => [x.get(`${mission.name}|${worker.type}`), worker.power]),
        -highs.infinity,
        requiredPower + largestWorkerPower
      );
    }
  });

  (specification.linearMinimums || []).forEach(minimum => {
    const entries = context.missions.map((mission, index) => [runs[index], minimum.runCosts[mission.name] || 0]);
    builder.addRow(entries, minimum.value, highs.infinity);
  });

  if (specification.utilityFactor > 0) {
    MATS.forEach(material => {
      const points = specification.utilityPoints?.[material] || [0, maximumTotals[material]];
      points.forEach(point => {
        const tangent = logarithmTangent(point, context.input.weights[material]);
        const entries = [[utility[material], 1]];
        context.missions.forEach((mission, index) => {
          entries.push([runs[index], -tangent.slope * context.tsMultiplier * mission.rewards[material]]);
        });
        builder.addRow(entries, -highs.infinity, tangent.intercept);
      });
    });
  }

  (specification.nonlinearMinimums || []).forEach(minimum => {
    minimum.points.forEach(pointTotals => {
      let intercept = 0;
      const coefficientByMission = Object.fromEntries(context.missions.map(mission => [mission.name, minimum.linearRunCosts?.[mission.name] || 0]));
      MATS.forEach(material => {
        const tangent = logarithmTangent(pointTotals[material] || 0, context.input.weights[material]);
        intercept += minimum.utilityFactor * tangent.intercept;
        context.missions.forEach(mission => {
          coefficientByMission[mission.name] += minimum.utilityFactor * tangent.slope * context.tsMultiplier * mission.rewards[material];
        });
      });
      builder.addRow(context.missions.map((mission, index) => [runs[index], coefficientByMission[mission.name]]), minimum.value - intercept, highs.infinity);
    });
  });

  const data = builder.build();
  return { data, layout: { x, runs, utility, columns: builder.columns, scales: builder.scales, objectiveScale: builder.objectiveScale } };
}

// Convert the solver's answer into personnel assignments.
function assignmentsFromVector_(context, layout, vector) {
  const assignments = [];
  context.missions.forEach(mission => {
    context.workers.forEach(worker => {
      const index = layout.x.get(`${mission.name}|${worker.type}`);
      const count = Math.max(0, Math.round(vector[index] || 0));
      if (count > 0) assignments.push({ name: mission.name, type: worker.type, count });
    });
  });
  return assignments;
}

// Convert an existing allocation into a starting point for the solver.
function vectorFromAssignments_(context, layout, assignments) {
  const vector = new Float64Array(layout.columns.length);
  assignments.forEach(({ name, type, count }) => {
    const index = layout.x.get(`${name}|${type}`);
    if (index != null) vector[index] = count;
  });
  context.missions.forEach((mission, missionIndex) => {
    let power = 0;
    context.workers.forEach(worker => {
      power += vector[layout.x.get(`${mission.name}|${worker.type}`)] * worker.power;
    });
    vector[layout.runs[missionIndex]] = Math.min(MAX_RUNS_PER_HOUR, mission.alpha * power) / layout.scales[layout.runs[missionIndex]];
  });
  return vector;
}

// Read a solver statistic, using a fallback if it is unavailable.
function safeInfo_(model, name, fallback) {
  try {
    const value = model.info.get(name);
    return typeof value === "bigint" ? Number(value) : value;
  } catch {
    return fallback;
  }
}

// Set the solver's accuracy requirements and repeatable starting seed.
function configureModel_(model, state) {
  model.options.set({
    output_flag: false,
    mip_rel_gap: SOLVE_RELATIVE_GAP,
    mip_abs_gap: 0,
    primal_feasibility_tolerance: 1e-9,
    dual_feasibility_tolerance: 1e-9,
    mip_feasibility_tolerance: 1e-9,
    small_matrix_value: 1e-12,
    random_seed: state.seed & 0x7fffffff
  });
}

// Run a prepared model and collect allocations, progress, and bounds.
async function solveExistingModel_(highs, context, model, layout, state) {
  state.activity.start(state.phase);
  if (state.warmAssignments?.length) {
    model.setSolution({ colValue: vectorFromAssignments_(context, layout, state.warmAssignments) });
  }
  const callbackType = highs.constants.callbackType;
  model.run({
    [callbackType.mipImprovingSolution](event) {
      state.activity.report(event.data, "Improving allocation");
      if (!event.data.mip_solution) return;
      const assignments = assignmentsFromVector_(context, layout, event.data.mip_solution);
      state.onSolution?.(assignments, event.data.mip_dual_bound / layout.objectiveScale, event.data.mip_gap);
    },
    [callbackType.mipLogging](event) {
      state.activity.report(event.data, "Searching allocations");
    },
    [callbackType.mipInterrupt](event) {
      state.activity.report(event.data, "Searching allocations");
    },
    [callbackType.simplexInterrupt]() {
      state.activity.report({}, "Checking score bounds");
    },
    [callbackType.ipmInterrupt]() {
      state.activity.report({}, "Checking score bounds");
    }
  });
  const status = model.getModelStatus();
  const solutionStatus = safeInfo_(model, "primal_solution_status", 0);
  if (solutionStatus !== highs.constants.solutionStatus.feasible && status !== highs.constants.modelStatus.optimal) {
    throw new Error(`HiGHS ended without a feasible allocation (status ${status}).`);
  }
  const vector = model.getSolution().colValue;
  const assignments = assignmentsFromVector_(context, layout, vector);
  const objective = model.getObjectiveValue() / layout.objectiveScale;
  const nodes = safeInfo_(model, "mip_node_count", 0);
  const dualBound = safeInfo_(model, "mip_dual_bound", NaN) / layout.objectiveScale;
  state.activity.report({
    mip_node_count: nodes,
    mip_total_lp_iterations: safeInfo_(model, "simplex_iteration_count", NaN),
    mip_gap: safeInfo_(model, "mip_gap", NaN)
  }, "Checking search result", true);
  return { assignments, objective, dualBound, nodes, status, optimal: status === highs.constants.modelStatus.optimal };
}

// Build and solve a model, then release its memory.
async function runModel_(highs, context, specification, state) {
  const { data, layout } = buildModel_(highs, context, specification);
  const model = highs.createModel();
  try {
    configureModel_(model, state);
    model.passModel(data);
    return await solveExistingModel_(highs, context, model, layout, state);
  } finally {
    model.dispose();
  }
}

// Combine repeated entries and keep only nonzero solver values.
function sparseEntries_(entries) {
  const combined = new Map();
  entries.forEach(([index, value]) => {
    if (value === 0) return;
    combined.set(index, (combined.get(index) || 0) + value);
  });
  const sorted = [...combined.entries()]
    .filter(([, value]) => value !== 0)
    .sort((a, b) => a[0] - b[0]);
  return { indices: sorted.map(([index]) => index), values: sorted.map(([, value]) => value) };
}

// Add a closer upper estimate for one resource's score.
function addUtilityTangentRow_(model, highs, context, layout, material, point) {
  const tangent = logarithmTangent(point, context.input.weights[material]);
  const entries = [[layout.utility[material], 1]];
  context.missions.forEach((mission, index) => {
    entries.push([layout.runs[index], -tangent.slope * context.tsMultiplier * mission.rewards[material]]);
  });
  const row = scaledRow_(entries, -highs.infinity, tangent.intercept, layout.scales, highs.infinity);
  model.addRow(row.lower, row.upper, sparseEntries_(row.entries));
}

// Add a rule that helps preserve an earlier score during tie-breaking.
function addNonlinearMinimumRow_(model, highs, context, layout, minimum, pointTotals) {
  let intercept = 0;
  const entries = [];
  context.missions.forEach((mission, index) => {
    let coefficient = minimum.linearRunCosts?.[mission.name] || 0;
    MATS.forEach(material => {
      const tangent = logarithmTangent(pointTotals[material] || 0, context.input.weights[material]);
      coefficient += minimum.utilityFactor * tangent.slope * context.tsMultiplier * mission.rewards[material];
    });
    entries.push([layout.runs[index], coefficient]);
  });
  MATS.forEach(material => {
    intercept += minimum.utilityFactor * logarithmTangent(
      pointTotals[material] || 0,
      context.input.weights[material]
    ).intercept;
  });
  const row = scaledRow_(entries, minimum.value - intercept, highs.infinity, layout.scales, highs.infinity);
  model.addRow(row.lower, row.upper, sparseEntries_(row.entries));
}

// Calculate the score earned by one run of each mission.
function runCosts_(context, kind) {
  return Object.fromEntries(context.missions.map(mission => {
    if (kind === "academy") return [mission.name, context.tsMultiplier * mission.academy];
    if (kind === "completions") return [mission.name, context.tsMultiplier];
    if (kind === "fragments") return [mission.name, mission.fragmentYield];
    return [mission.name, 0];
  }));
}

// Score an allocation using fixed rewards per mission run.
function linearValue_(context, assignments, runCosts) {
  const byMission = Object.fromEntries(context.missions.map(mission => [mission.name, 0]));
  assignments.forEach(({ name, type, count }) => { byMission[name] += context.input.workers[type].power * count; });
  return context.missions.reduce((sum, mission) => sum +
    Math.min(MAX_RUNS_PER_HOUR, mission.alpha * byMission[mission.name]) * (runCosts[mission.name] || 0), 0);
}

// Calculate only the resource totals for an allocation.
function resourceTotalsFromAssignments_(context, assignments) {
  const { totals } = evaluateFarmAssignments_(context, assignments);
  return Object.fromEntries(MATS.map(material => [material, totals[material]]));
}

// Remember new resource amounts for refining score estimates.
function addUniquePoint_(points, totals) {
  const added = [];
  MATS.forEach(material => {
    const value = Math.max(0, totals[material] || 0);
    if (!points[material].some(existing => Math.abs(existing - value) <= 1e-12 * Math.max(Math.abs(existing), value))) {
      points[material].push(value);
      added.push([material, value]);
    }
  });
  return added;
}

// Check whether two sets of resource totals are effectively the same.
function sameResourcePoint_(left, right) {
  return MATS.every(material => {
    const leftValue = left[material] || 0;
    const rightValue = right[material] || 0;
    return Math.abs(leftValue - rightValue) <= 1e-12 * Math.max(Math.abs(leftValue), Math.abs(rightValue));
  });
}

// Save a set of resource totals unless it is already recorded.
function addUniqueResourcePoint_(points, totals) {
  if (points.some(point => sameResourcePoint_(point, totals))) return false;
  points.push(Object.fromEntries(MATS.map(material => [material, Math.max(0, totals[material] || 0)])));
  return true;
}

// Find and verify an allocation scored with fixed rewards per run.
async function solveLinear_(highs, context, runCosts, state, linearMinimums = [], nonlinearMinimums = []) {
  const result = await runModel_(highs, context, { runCosts, utilityFactor: 0, linearMinimums, nonlinearMinimums }, state);
  if (!result.optimal) throw new Error("HiGHS stopped before reaching the configured linear optimality tolerance.");
  validateFarmAssignments_(context, result.assignments);
  const certificate = certifyBound_(linearValue_(context, result.assignments, runCosts), result.dualBound, SOLVE_RELATIVE_GAP * 2);
  if (!certificate) throw new Error("The solver's linear bound could not be verified against the returned allocation.");
  result.dualBound = certificate.upperBound;
  return result;
}

// Refine resource-score estimates until the result meets the accuracy target.
async function solveConcave_(highs, context, parameters, state) {
  const maximumTotals = maxResourceTotals_(context);
  const points = Object.fromEntries(MATS.map(material => [material, [0, maximumTotals[material]]]));
  const vectors = [];
  (parameters.initialPoints || []).forEach(totals => {
    addUniquePoint_(points, totals);
    addUniqueResourcePoint_(vectors, totals);
  });
  if (state.warmAssignments?.length) {
    const warmTotals = resourceTotalsFromAssignments_(context, state.warmAssignments);
    addUniquePoint_(points, warmTotals);
    addUniqueResourcePoint_(vectors, warmTotals);
  }
  let bestAssignments = state.warmAssignments || [];
  let bestValue = parameters.exactValue(bestAssignments);
  let totalNodes = 0;
  let iterations = 0;
  let upperBound = Infinity;

  const { data, layout } = buildModel_(highs, context, {
    runCosts: parameters.runCosts,
    utilityFactor: parameters.utilityFactor,
    utilityPoints: points,
    linearMinimums: parameters.linearMinimums || [],
    nonlinearMinimums: parameters.nonlinearMinimums || []
  });
  const model = highs.createModel();
  try {
    configureModel_(model, state);
    model.passModel(data);
    while (true) {
      iterations++;
      const solve = await solveExistingModel_(highs, context, model, layout, {
        ...state,
        nodeOffset: totalNodes,
        warmAssignments: bestAssignments,
        // Keep useful allocations found during this search stage.
        onSolution(assignments, bound, solverGap) {
          const value = parameters.exactValue(assignments);
          if (value > bestValue) {
            bestValue = value;
            bestAssignments = assignments;
            state.onExactSolution?.(assignments, value, bound, relativeGap(value, bound) ?? solverGap);
          }
        }
      });
      totalNodes += solve.nodes;
      upperBound = solve.dualBound;
      const candidateValue = parameters.exactValue(solve.assignments);
      const candidateTotals = resourceTotalsFromAssignments_(context, solve.assignments);
      addUniqueResourcePoint_(vectors, candidateTotals);
      if (candidateValue > bestValue) {
        bestValue = candidateValue;
        bestAssignments = solve.assignments;
        state.onExactSolution?.(bestAssignments, bestValue, upperBound, relativeGap(bestValue, upperBound));
      }
      const gap = relativeGap(bestValue, upperBound);
      state.onProgress({ phase: state.phase, determinate: false, completed: 0, total: 1, nodes: totalNodes, upperBound, relativeGap: gap, elapsedMs: performance.now() - state.startedAt });
      const certificate = certifyBound_(bestValue, upperBound, SOLVE_RELATIVE_GAP * 2);
      if (solve.optimal && certificate) {
        validateFarmAssignments_(context, bestAssignments);
        return { assignments: bestAssignments, value: bestValue, ...certificate, nodes: totalNodes, iterations, optimal: true, points, vectors };
      }
      const added = addUniquePoint_(points, candidateTotals);
      if (added.length === 0) {
        throw new Error("The logarithmic search stalled before reaching its configured gap.");
      }
      added.forEach(([material, point]) => addUtilityTangentRow_(model, highs, context, layout, material, point));
    }
  } finally {
    model.dispose();
  }
}

// Improve a secondary reward while preserving the required main score.
async function solveLinearWithConcaveMinimum_(highs, context, parameters, state) {
  const points = [];
  (parameters.initialPoints || []).forEach(point => addUniqueResourcePoint_(points, point));
  addUniqueResourcePoint_(points, resourceTotalsFromAssignments_(context, state.warmAssignments || []));
  let totalNodes = 0;
  let iterations = 0;

  const minimum = {
    linearRunCosts: parameters.primaryRunCosts,
    utilityFactor: parameters.primaryUtilityFactor,
    value: parameters.minimumValue,
    points
  };
  const { data, layout } = buildModel_(highs, context, {
    runCosts: parameters.secondaryRunCosts,
    utilityFactor: 0,
    linearMinimums: parameters.linearMinimums || [],
    nonlinearMinimums: [minimum]
  });
  const model = highs.createModel();
  try {
    configureModel_(model, state);
    model.passModel(data);
    while (true) {
      iterations++;
      const solve = await solveExistingModel_(highs, context, model, layout, {
        ...state,
        nodeOffset: totalNodes,
        // Keep useful allocations found during this search stage.
        onSolution(assignments, bound, gap) {
          if (parameters.primaryExactValue(assignments) >= parameters.minimumValue * (1 - BOUND_ROUNDOFF)) {
            state.onExactSolution?.(assignments, linearValue_(context, assignments, parameters.secondaryRunCosts), bound, gap);
          }
        }
      });
      if (!solve.optimal) throw new Error("HiGHS stopped before reaching the configured linear optimality tolerance.");
      totalNodes += solve.nodes;
      const primaryValue = parameters.primaryExactValue(solve.assignments);
      if (primaryValue >= parameters.minimumValue * (1 - BOUND_ROUNDOFF)) {
        return { ...solve, nodes: totalNodes, iterations, optimal: true, points };
      }
      const totals = resourceTotalsFromAssignments_(context, solve.assignments);
      if (!addUniqueResourcePoint_(points, totals)) {
        throw new Error("The nonlinear tie-break search stalled before reaching a feasible result.");
      }
      addNonlinearMinimumRow_(model, highs, context, layout, minimum, totals);
    }
  } finally {
    model.dispose();
  }
}

// Set the smallest main score allowed during tie-breaking.
function primaryMinimum_(value) {
  return value * (1 - SOLVE_RELATIVE_GAP);
}

// Collect the solver version and work counts for the result.
function solverStats_(highs, state) {
  return {
    engine: "HiGHS WebAssembly",
    version: highs?.version?.string || SOLVER_PACKAGE_VERSION,
    nodes: state.nodes,
    iterations: state.iterations
  };
}

// Run Overkill, check its accuracy, and return the best complete allocation.
export async function optimizeCrazy(rawInput, options = {}) {
  solverDiagnostics.length = 0;
  let phase = "preparing";
  try {
    return await optimizeCrazy_(rawInput, {
      ...options,
      // Remember where the solver stopped if it fails unexpectedly.
      onProgress(progress) {
        phase = buildProgressView(progress).phaseLabel;
        options.onProgress?.(progress);
      }
    });
  } catch (error) {
    if (error instanceof OptimizerValidationError) throw error;
    highsPromise = undefined;
    if (/abort|wasm|memory access/i.test(error?.message || "")) {
      const details = solverDiagnostics.filter(message => !message.includes("Build with -sASSERTIONS"));
      throw new Error(`${error.message} Stage: ${phase}.${details.length ? ` Solver details: ${details.join(" ")}` : ""}`, { cause: error });
    }
    throw error;
  }
}

// Find an allocation and verify it against the requested accuracy target.
async function optimizeCrazy_(rawInput, options = {}) {
  const { input, errors } = validateInput(rawInput);
  if (errors.length) throw new OptimizerValidationError(errors);
  const seedInput = { ...input, selectedFarmMissions: [...input.selectedFarmMissions].sort(), selectedCampaignFarmMissions: [...input.selectedCampaignFarmMissions].sort() };
  const seed = deriveSeed(seedInput);
  const effectiveSeedFarms = input.campaignEnabled
    ? [...input.selectedCampaignFarmMissions].sort()
    : [...input.selectedFarmMissions].sort();
  const solverSeed = deriveSeed({
    ...seedInput,
    campaignEnabled: false,
    campaignTargetName: "",
    relic11Level: 0,
    selectedFarmMissions: effectiveSeedFarms,
    selectedCampaignFarmMissions: effectiveSeedFarms
  });
  // Use the caller's progress handler, or ignore updates when none is supplied.
  const onProgress = options.onProgress || (() => {});
  // Use the caller's handler for saving complete allocations during the search.
  const onCheckpoint = options.onCheckpoint || (() => {});
  const startedAt = performance.now();
  const context = buildContext_(input);

  const standard = optimize({ ...input, searchEffort: "standard" }, {
    // Forward the starting search's progress under its own phase name.
    onProgress(progress) { onProgress({ ...progress, phase: `standard-${progress.phase}`, elapsedMs: performance.now() - startedAt }); }
  });
  let checkpointAssignments = farmAssignmentsFromResult_(standard);
  let checkpointSummary = evaluateFarmAssignments_(context, checkpointAssignments).summary;
  const initialCheckpoint = finalizeResult_(context, checkpointAssignments, {
    solutionStatus: "best-found",
    upperBound: null,
    relativeGap: null,
    solverStats: { engine: "CIFI heuristic", version: "3.0.3", nodes: 0, iterations: standard.solverStats?.iterations || 0 },
    hybridIdeals: standard.hybridIdeals,
    seed
  });
  onCheckpoint(initialCheckpoint);

  if (context.missions.length === 0 || context.workers.length === 0) {
    return finalizeResult_(context, checkpointAssignments, {
      solutionStatus: "optimal",
      upperBound: 0,
      relativeGap: 0,
      solverStats: { engine: "Trivial exact", version: "1", nodes: 0, iterations: 0 },
      hybridIdeals: getModeKind(input.mode) === "hybrid" ? {
        fragments: 0,
        resourceUtility: 0,
        fragmentWeight: input.hybridFragmentPercent / 100,
        resourceWeight: 1 - input.hybridFragmentPercent / 100,
        proven: true
      } : null,
      seed
    });
  }

  onProgress({ phase: "loading-solver", determinate: false, completed: 0, total: 1, elapsedMs: performance.now() - startedAt });
  const highs = await loadSolver_();
  const aggregate = { nodes: 0, iterations: 0 };
  const activity = createSolverProgress(onProgress, startedAt);
  let hybridIdeals = null;
  let primaryUpperBound = null;
  let primaryGap = 0;
  const kind = getModeKind(input.mode);

  // Save an improved complete allocation in case the search stops early.
  const checkpoint = (assignments, upperBound = primaryUpperBound, gap = primaryGap) => {
    const summary = evaluateFarmAssignments_(context, assignments).summary;
    if (compareSummaries(input.mode, summary, checkpointSummary, hybridIdeals) <= 0) return;
    checkpointAssignments = assignments;
    checkpointSummary = summary;
    onCheckpoint(finalizeResult_(context, assignments, {
      solutionStatus: "best-found",
      upperBound,
      relativeGap: gap,
      solverStats: solverStats_(highs, aggregate),
      hybridIdeals,
      seed
    }));
  };
  // Prepare the shared settings for the next search stage.
  const commonState = phase => ({
    seed: solverSeed, phase, startedAt, activity, warmAssignments: checkpointAssignments,
    // Keep the last work counters while checking a search result.
    onProgress(progress) { onProgress({ ...activity.progress, ...progress }); }
  });

  let finalAssignments = checkpointAssignments;
  let primaryAssignments = checkpointAssignments;
  if (kind === "academy" || kind === "completions") {
    const primaryCosts = runCosts_(context, kind);
    const primary = await solveLinear_(highs, context, primaryCosts, {
      ...commonState("crazy-primary"),
      onSolution: assignments => checkpoint(assignments)
    });
    aggregate.nodes += primary.nodes; aggregate.iterations++;
    const primaryValue = linearValue_(context, primary.assignments, primaryCosts);
    primaryAssignments = primary.assignments;
    primaryUpperBound = primary.dualBound;
    primaryGap = relativeGap(primaryValue, primaryUpperBound) || 0;
    const primaryMinimums = [{ runCosts: primaryCosts, value: primaryMinimum_(primaryValue) }];
    const secondaryKind = kind === "academy" ? "completions" : "fragments";
    const secondaryCosts = runCosts_(context, secondaryKind);
    const secondary = await solveLinear_(highs, context, secondaryCosts, {
      ...commonState("crazy-tiebreak"),
      warmAssignments: primary.assignments,
      onSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    }, primaryMinimums);
    aggregate.nodes += secondary.nodes; aggregate.iterations++;
    if (kind === "completions") {
      const secondaryValue = linearValue_(context, secondary.assignments, secondaryCosts);
      const tertiary = await solveLinear_(highs, context, primaryCosts, {
        ...commonState("crazy-utilisation"),
        warmAssignments: secondary.assignments,
        onSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
      }, [
        ...primaryMinimums,
        { runCosts: secondaryCosts, value: primaryMinimum_(secondaryValue) }
      ]);
      aggregate.nodes += tertiary.nodes; aggregate.iterations++;
      finalAssignments = tertiary.assignments;
    } else {
      finalAssignments = secondary.assignments;
    }
  } else if (kind === "fragments") {
    const fragmentCosts = runCosts_(context, "fragments");
    const primary = await solveLinear_(highs, context, fragmentCosts, {
      ...commonState("crazy-primary"),
      onSolution: assignments => checkpoint(assignments)
    });
    aggregate.nodes += primary.nodes; aggregate.iterations++;
    const fragmentIdeal = linearValue_(context, primary.assignments, fragmentCosts);
    primaryAssignments = primary.assignments;
    primaryUpperBound = primary.dualBound;
    primaryGap = relativeGap(fragmentIdeal, primaryUpperBound) || 0;
    const secondary = await solveConcave_(highs, context, {
      runCosts: {}, utilityFactor: 1,
      linearMinimums: [{ runCosts: fragmentCosts, value: primaryMinimum_(fragmentIdeal) }],
      exactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility
    }, {
      ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments,
      onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    });
    aggregate.nodes += secondary.nodes; aggregate.iterations += secondary.iterations;
    const tertiary = await solveLinearWithConcaveMinimum_(highs, context, {
      primaryRunCosts: {}, primaryUtilityFactor: 1,
      primaryExactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility,
      minimumValue: primaryMinimum_(secondary.value),
      secondaryRunCosts: runCosts_(context, "completions"),
      linearMinimums: [{ runCosts: fragmentCosts, value: primaryMinimum_(fragmentIdeal) }],
      initialPoints: secondary.vectors
    }, {
      ...commonState("crazy-utilisation"), warmAssignments: secondary.assignments,
      onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    });
    aggregate.nodes += tertiary.nodes; aggregate.iterations += tertiary.iterations;
    finalAssignments = tertiary.assignments;
  } else if (kind === "resources") {
    const primary = await solveConcave_(highs, context, {
      runCosts: {}, utilityFactor: 1,
      exactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility
    }, {
      ...commonState("crazy-primary"),
      onExactSolution: (assignments, value, bound, gap) => checkpoint(assignments, bound, gap)
    });
    aggregate.nodes += primary.nodes; aggregate.iterations += primary.iterations;
    primaryAssignments = primary.assignments;
    primaryUpperBound = primary.upperBound;
    primaryGap = primary.relativeGap;
    const secondary = await solveLinearWithConcaveMinimum_(highs, context, {
      primaryRunCosts: {}, primaryUtilityFactor: 1,
      primaryExactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility,
      minimumValue: primaryMinimum_(primary.value),
      secondaryRunCosts: runCosts_(context, "fragments"),
      initialPoints: primary.vectors
    }, {
      ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments,
      onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    });
    aggregate.nodes += secondary.nodes; aggregate.iterations += secondary.iterations;
    const fragmentCosts = runCosts_(context, "fragments");
    const secondaryValue = linearValue_(context, secondary.assignments, fragmentCosts);
    const tertiary = await solveLinearWithConcaveMinimum_(highs, context, {
      primaryRunCosts: {}, primaryUtilityFactor: 1,
      primaryExactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility,
      minimumValue: primaryMinimum_(primary.value),
      secondaryRunCosts: runCosts_(context, "completions"),
      linearMinimums: [{ runCosts: fragmentCosts, value: primaryMinimum_(secondaryValue) }],
      initialPoints: [...primary.vectors, ...secondary.points]
    }, {
      ...commonState("crazy-utilisation"), warmAssignments: secondary.assignments,
      onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    });
    aggregate.nodes += tertiary.nodes; aggregate.iterations += tertiary.iterations;
    finalAssignments = tertiary.assignments;
  } else {
    const fragmentCosts = runCosts_(context, "fragments");
    const fragmentIdealSolve = await solveLinear_(highs, context, fragmentCosts, commonState("crazy-fragment-ideal"));
    aggregate.nodes += fragmentIdealSolve.nodes; aggregate.iterations++;
    const fragmentIdeal = linearValue_(context, fragmentIdealSolve.assignments, fragmentCosts);
    const resourceIdealSolve = await solveConcave_(highs, context, {
      runCosts: {}, utilityFactor: 1,
      exactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility
    }, { ...commonState("crazy-resource-ideal"), warmAssignments: fragmentIdealSolve.assignments });
    aggregate.nodes += resourceIdealSolve.nodes; aggregate.iterations += resourceIdealSolve.iterations;
    const resourceIdeal = resourceIdealSolve.value;
    const fragmentWeight = input.hybridFragmentPercent / 100;
    const resourceWeight = 1 - fragmentWeight;
    hybridIdeals = {
      fragments: fragmentIdeal, resourceUtility: resourceIdeal, fragmentWeight, resourceWeight,
      fragmentUpperBound: fragmentIdealSolve.dualBound,
      resourceUpperBound: resourceIdealSolve.upperBound,
      proven: true
    };

    let fragmentFactor = 0;
    let utilityFactor = 0;
    if (fragmentIdeal === 0 && resourceIdeal === 0) {
      const completion = await solveLinear_(highs, context, runCosts_(context, "completions"), {
        ...commonState("crazy-primary"),
        onSolution: assignments => checkpoint(assignments)
      });
      aggregate.nodes += completion.nodes; aggregate.iterations++;
      finalAssignments = completion.assignments;
      primaryAssignments = completion.assignments;
      primaryUpperBound = completion.dualBound;
      primaryGap = relativeGap(linearValue_(context, finalAssignments, runCosts_(context, "completions")), primaryUpperBound) || 0;
    } else {
      if (fragmentIdeal === 0) utilityFactor = 1 / resourceIdeal;
      else if (resourceIdeal === 0) fragmentFactor = 1 / fragmentIdeal;
      else { fragmentFactor = fragmentWeight / fragmentIdeal; utilityFactor = resourceWeight / resourceIdeal; }
      const hybridRunCosts = Object.fromEntries(context.missions.map(mission => [mission.name, fragmentFactor * mission.fragmentYield]));
      // Calculate the hybrid score from the allocation's actual rewards.
      const exactHybrid = assignments => normalizedHybridScore(evaluateFarmAssignments_(context, assignments).summary, hybridIdeals);
      const primary = utilityFactor > 0
        ? await solveConcave_(highs, context, { runCosts: hybridRunCosts, utilityFactor, exactValue: exactHybrid }, {
            ...commonState("crazy-primary"), warmAssignments: checkpointAssignments,
            onExactSolution: (assignments, value, bound, gap) => checkpoint(assignments, bound, gap)
          })
        : await solveLinear_(highs, context, hybridRunCosts, {
            ...commonState("crazy-primary"),
            onSolution: assignments => checkpoint(assignments)
          });
      aggregate.nodes += primary.nodes; aggregate.iterations += primary.iterations || 1;
      const primaryValue = exactHybrid(primary.assignments);
      primaryAssignments = primary.assignments;
      primaryUpperBound = primary.upperBound ?? primary.dualBound;
      primaryGap = primary.relativeGap ?? relativeGap(primaryValue, primaryUpperBound) ?? 0;
      if (utilityFactor > 0) {
        const secondary = await solveLinearWithConcaveMinimum_(highs, context, {
          primaryRunCosts: hybridRunCosts,
          primaryUtilityFactor: utilityFactor,
          primaryExactValue: exactHybrid,
          minimumValue: primaryMinimum_(primaryValue),
          secondaryRunCosts: runCosts_(context, "completions"),
          initialPoints: primary.vectors
        }, {
          ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments,
          onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
        });
        aggregate.nodes += secondary.nodes; aggregate.iterations += secondary.iterations;
        finalAssignments = secondary.assignments;
      } else {
        const secondary = await solveLinear_(highs, context, runCosts_(context, "completions"), {
          ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments
        }, [{ runCosts: hybridRunCosts, value: primaryMinimum_(primaryValue) }]);
        aggregate.nodes += secondary.nodes; aggregate.iterations++;
        finalAssignments = secondary.assignments;
      }
    }
  }

  for (const candidate of [primaryAssignments, checkpointAssignments]) {
    if (compareSummaries(input.mode, evaluateFarmAssignments_(context, candidate).summary,
      evaluateFarmAssignments_(context, finalAssignments).summary, hybridIdeals, 0) > 0) finalAssignments = candidate;
  }
  const finalSummary = evaluateFarmAssignments_(context, finalAssignments).summary;
  const finalPrimary = describeObjective(input.mode, finalSummary, hybridIdeals).primaryValue;
  primaryGap = relativeGap(finalPrimary, primaryUpperBound) ?? primaryGap;
  const result = finalizeResult_(context, finalAssignments, {
    solutionStatus: "tolerance-met",
    upperBound: primaryUpperBound,
    relativeGap: primaryGap,
    solverStats: solverStats_(highs, aggregate),
    hybridIdeals,
    seed
  });
  onProgress({ phase: "complete", determinate: true, completed: 1, total: 1, nodes: aggregate.nodes, upperBound: result.objective.upperBound, relativeGap: result.objective.relativeGap, elapsedMs: performance.now() - startedAt });
  return result;
}

export {
  buildContext_ as buildCrazyContextForTest,
  evaluateFarmAssignments_ as evaluateCrazyAssignmentsForTest,
  maxResourceTotals_ as maxResourceTotalsForTest,
  missionRunUpperBound_ as missionRunUpperBoundForTest,
  rebalanceFarmAssignments_ as rebalanceCrazyAssignmentsForTest,
  workerMissionUpperBound_ as workerMissionUpperBoundForTest,
  certifyBound_ as certifyBoundForTest
};
