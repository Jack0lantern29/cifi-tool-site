import {
  CAMPAIGN_BASE_CAPS,
  getFx4FragmentBonusMultiplier,
  MATS,
  MISSION_DATA,
  OURO_OFF_VISIBLE_FARMS,
  TYPE_ORDER,
  TYPE_RANK
} from "./data.js?v=3.0.2";
import {
  compareSummaries,
  describeObjective,
  getModeKind,
  normalizedHybridScore,
  PROOF_RELATIVE_GAP,
  relativeGap,
  summaryFromTotals
} from "./objective.js?v=3.0.2";
import { optimize, OptimizerValidationError } from "./optimizer.js?v=3.0.2";
import { deriveSeed, formatRunId } from "./random.js?v=3.0.2";
import { calculateGlobalSpeedMultiplier, validateInput } from "./validation.js?v=3.0.2";

const MAX_RUNS_PER_HOUR = 1800;
const NUMERIC_EPSILON = 1e-9;
const SOLVER_PACKAGE_VERSION = "1.15.3-pre.4";

let highsPromise;

async function loadSolver_() {
  if (!highsPromise) {
    highsPromise = import("../vendor/highs/highs.mjs?v=3.0.2").then(({ default: loadHighs }) => loadHighs({
      locateFile: file => file.endsWith(".wasm")
        ? new URL("../vendor/highs/highs.wasm?v=3.0.2", import.meta.url).href
        : file,
      print: () => {},
      printErr: () => {}
    }));
  }
  return highsPromise;
}

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

function emptyTotals_() {
  const totals = { Academy: 0, Completions: 0, Fragments: 0 };
  MATS.forEach(material => { totals[material] = 0; });
  return totals;
}

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

function effectiveCampaignCap_(input) {
  if (!input.campaignEnabled) return 0;
  const base = CAMPAIGN_BASE_CAPS[input.campaignTargetName] || 0;
  const relicMultiplier = input.ouroUnlocked ? 1 + input.relic11Level * 0.5 : 1;
  return Math.round(base * relicMultiplier);
}

function removeRedundantCappedAssignments_(context, farmAssignments) {
  // Assignment variables have no objective cost after a mission reaches the
  // two-second floor, so an otherwise optimal MILP solution may contain spare
  // workers. Strip those workers without changing any farm output.
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

function finalizeResult_(context, farmAssignments, metadata) {
  const { input } = context;
  const finalFarmAssignments = removeRedundantCappedAssignments_(context, farmAssignments);
  const { totals, summary } = evaluateFarmAssignments_(context, finalFarmAssignments);
  const remaining = Object.fromEntries(TYPE_ORDER.map(type => [type, input.workers[type].count]));
  finalFarmAssignments.forEach(({ type, count }) => { remaining[type] -= count; });

  const assignments = finalFarmAssignments.map(assignment => ({ ...assignment }));
  const campaignCapacity = effectiveCampaignCap_(input);
  let campaignAssigned = 0;
  let campaignPower = 0;
  if (input.campaignEnabled && campaignCapacity > 0) {
    TYPE_ORDER.forEach(type => {
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
  const notices = [];
  if (context.missions.length === 0) notices.push("No farm missions were selected for this run.");
  if (input.campaignEnabled && campaignAssigned >= campaignCapacity && Object.values(remaining).some(count => count > 0)) {
    notices.push("Campaign capacity was reached; some personnel remain unassigned.");
  }
  if (assignments.length === 0) notices.push("No personnel could be assigned with the current inputs.");
  if (metadata.solutionStatus === "cancelled-best") notices.push("Crazy Optimisation was cancelled; this is the best complete allocation found before cancellation.");

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
    solutionStatus: metadata.solutionStatus,
    objective: {
      ...objectiveBase,
      upperBound: Number.isFinite(metadata.upperBound) ? metadata.upperBound : null,
      relativeGap: Number.isFinite(metadata.relativeGap) ? metadata.relativeGap : null
    },
    solverStats: metadata.solverStats,
    hybridIdeals: metadata.hybridIdeals || null,
    seed: metadata.seed,
    runId: formatRunId(metadata.seed),
    notices
  };
}

function farmAssignmentsFromResult_(result) {
  return result.assignments.filter(assignment => assignment.name.startsWith("F"));
}

class ModelBuilder_ {
  constructor(highs) {
    this.highs = highs;
    this.columns = [];
    this.rows = [];
  }

  addColumn(name, lower, upper, cost = 0, integer = false) {
    const index = this.columns.length;
    this.columns.push({ name, lower, upper, cost, integer });
    return index;
  }

  addRow(entries, lower, upper) {
    const combined = new Map();
    entries.forEach(([index, value]) => {
      if (Math.abs(value) <= NUMERIC_EPSILON) return;
      combined.set(index, (combined.get(index) || 0) + value);
    });
    this.rows.push({ entries: [...combined.entries()].filter(([, value]) => Math.abs(value) > NUMERIC_EPSILON), lower, upper });
  }

  build() {
    const starts = [0];
    const indices = [];
    const values = [];
    this.rows.forEach(row => {
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
      colCost: this.columns.map(column => column.cost),
      colLower: this.columns.map(column => column.lower),
      colUpper: this.columns.map(column => column.upper),
      rowLower: this.rows.map(row => row.lower),
      rowUpper: this.rows.map(row => row.upper),
      matrix: { format: "csr", numRows: this.rows.length, numCols: this.columns.length, starts, indices, values },
      integrality: this.columns.map(column => column.integer
        ? this.highs.constants.variableType.integer
        : this.highs.constants.variableType.continuous),
      colNames: this.columns.map(column => column.name)
    };
  }
}

function maxResourceTotals_(context) {
  return Object.fromEntries(MATS.map(material => [material,
    MAX_RUNS_PER_HOUR * context.tsMultiplier * context.missions.reduce((sum, mission) => sum + mission.rewards[material], 0)
  ]));
}

export function logarithmTangent(value, weight = 1) {
  const point = Math.max(0, value);
  const slope = weight / (point + 1);
  return { slope, intercept: weight * Math.log(point + 1) - slope * point };
}

function buildModel_(highs, context, specification) {
  const builder = new ModelBuilder_(highs);
  const x = new Map();
  context.missions.forEach((mission, missionIndex) => {
    context.workers.forEach(worker => {
      const index = builder.addColumn(`x_${missionIndex}_${TYPE_RANK[worker.type]}`, 0, Math.min(worker.count, mission.cap), 0, true);
      x.set(`${mission.name}|${worker.type}`, index);
    });
  });
  const runs = context.missions.map((mission, index) => builder.addColumn(
    `runs_${index}`,
    0,
    MAX_RUNS_PER_HOUR,
    specification.runCosts?.[mission.name] || 0,
    false
  ));
  const utility = {};
  const maximumTotals = maxResourceTotals_(context);
  if (specification.utilityFactor > 0) {
    MATS.forEach(material => {
      const upper = context.input.weights[material] * Math.log(maximumTotals[material] + 1);
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

  return { data: builder.build(), layout: { x, runs, utility, columns: builder.columns } };
}

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
    vector[layout.runs[missionIndex]] = Math.min(MAX_RUNS_PER_HOUR, mission.alpha * power);
  });
  return vector;
}

function safeInfo_(model, name, fallback) {
  try {
    const value = model.info.get(name);
    return typeof value === "bigint" ? Number(value) : value;
  } catch {
    return fallback;
  }
}

async function runModel_(highs, context, specification, state) {
  const { data, layout } = buildModel_(highs, context, specification);
  const model = highs.createModel(data);
  let latestProgress = 0;
  try {
    model.options.set({
      output_flag: false,
      mip_rel_gap: 0,
      mip_abs_gap: 0,
      random_seed: state.seed & 0x7fffffff
    });
    if (state.warmAssignments?.length) {
      model.setSolution({ colValue: vectorFromAssignments_(context, layout, state.warmAssignments) });
    }
    const callbackType = highs.constants.callbackType;
    model.run({
      [callbackType.mipImprovingSolution](event) {
        if (!event.data.mip_solution) return;
        const assignments = assignmentsFromVector_(context, layout, event.data.mip_solution);
        state.onSolution?.(assignments, event.data.mip_dual_bound, event.data.mip_gap);
      },
      [callbackType.mipLogging](event) {
        const now = performance.now();
        if (now - latestProgress < 200) return;
        latestProgress = now;
        state.onProgress({
          phase: state.phase,
          completed: 0,
          total: 1,
          nodes: Number(event.data.mip_node_count || 0n),
          upperBound: event.data.mip_dual_bound,
          relativeGap: event.data.mip_gap,
          elapsedMs: now - state.startedAt
        });
      }
    });
    const status = model.getModelStatus();
    const solutionStatus = safeInfo_(model, "primal_solution_status", 0);
    if (solutionStatus !== highs.constants.solutionStatus.feasible && status !== highs.constants.modelStatus.optimal) {
      throw new Error(`HiGHS ended without a feasible allocation (status ${status}).`);
    }
    const vector = model.getSolution().colValue;
    const assignments = assignmentsFromVector_(context, layout, vector);
    const objective = model.getObjectiveValue();
    const nodes = safeInfo_(model, "mip_node_count", 0);
    const dualBound = safeInfo_(model, "mip_dual_bound", objective);
    return { assignments, objective, dualBound, nodes, status, optimal: status === highs.constants.modelStatus.optimal };
  } finally {
    model.dispose();
  }
}

function runCosts_(context, kind) {
  return Object.fromEntries(context.missions.map(mission => {
    if (kind === "academy") return [mission.name, context.tsMultiplier * mission.academy];
    if (kind === "completions") return [mission.name, context.tsMultiplier];
    if (kind === "fragments") return [mission.name, mission.fragmentYield];
    return [mission.name, 0];
  }));
}

function linearValue_(context, assignments, runCosts) {
  const byMission = Object.fromEntries(context.missions.map(mission => [mission.name, 0]));
  assignments.forEach(({ name, type, count }) => { byMission[name] += context.input.workers[type].power * count; });
  return context.missions.reduce((sum, mission) => sum +
    Math.min(MAX_RUNS_PER_HOUR, mission.alpha * byMission[mission.name]) * (runCosts[mission.name] || 0), 0);
}

function resourceTotalsFromAssignments_(context, assignments) {
  const { totals } = evaluateFarmAssignments_(context, assignments);
  return Object.fromEntries(MATS.map(material => [material, totals[material]]));
}

function addUniquePoint_(points, totals) {
  let added = false;
  MATS.forEach(material => {
    const value = Math.max(0, totals[material] || 0);
    if (!points[material].some(existing => Math.abs(existing - value) <= NUMERIC_EPSILON * Math.max(1, value))) {
      points[material].push(value);
      added = true;
    }
  });
  return added;
}

async function solveLinear_(highs, context, runCosts, state, linearMinimums = [], nonlinearMinimums = []) {
  const result = await runModel_(highs, context, { runCosts, utilityFactor: 0, linearMinimums, nonlinearMinimums }, state);
  if (!result.optimal) throw new Error("HiGHS stopped before proving the linear allocation optimal.");
  return result;
}

async function solveConcave_(highs, context, parameters, state) {
  const maximumTotals = maxResourceTotals_(context);
  const points = Object.fromEntries(MATS.map(material => [material, [0, maximumTotals[material]]]));
  let bestAssignments = state.warmAssignments || [];
  let bestValue = parameters.exactValue(bestAssignments);
  let totalNodes = 0;
  let iterations = 0;
  let upperBound = Infinity;

  while (true) {
    iterations++;
    const solve = await runModel_(highs, context, {
      runCosts: parameters.runCosts,
      utilityFactor: parameters.utilityFactor,
      utilityPoints: points,
      linearMinimums: parameters.linearMinimums || [],
      nonlinearMinimums: parameters.nonlinearMinimums || []
    }, {
      ...state,
      warmAssignments: bestAssignments,
      onSolution(assignments, bound, solverGap) {
        const value = parameters.exactValue(assignments);
        if (value > bestValue + NUMERIC_EPSILON) {
          bestValue = value;
          bestAssignments = assignments;
          state.onExactSolution?.(assignments, value, bound, relativeGap(value, bound) ?? solverGap);
        }
      }
    });
    totalNodes += solve.nodes;
    upperBound = solve.dualBound;
    const candidateValue = parameters.exactValue(solve.assignments);
    if (candidateValue > bestValue + NUMERIC_EPSILON) {
      bestValue = candidateValue;
      bestAssignments = solve.assignments;
      state.onExactSolution?.(bestAssignments, bestValue, upperBound, relativeGap(bestValue, upperBound));
    }
    const gap = relativeGap(bestValue, upperBound);
    state.onProgress({ phase: state.phase, completed: 0, total: 1, nodes: totalNodes, upperBound, relativeGap: gap, elapsedMs: performance.now() - state.startedAt });
    if (solve.optimal && gap != null && gap <= PROOF_RELATIVE_GAP) {
      return { assignments: bestAssignments, value: bestValue, upperBound, relativeGap: gap, nodes: totalNodes, iterations, optimal: true, points };
    }
    const candidateTotals = resourceTotalsFromAssignments_(context, solve.assignments);
    if (!addUniquePoint_(points, candidateTotals)) {
      throw new Error("The logarithmic proof search stalled before closing its certified gap.");
    }
  }
}

async function solveLinearWithConcaveMinimum_(highs, context, parameters, state) {
  const points = [resourceTotalsFromAssignments_(context, state.warmAssignments || [])];
  let totalNodes = 0;
  let iterations = 0;
  while (true) {
    iterations++;
    const minimum = {
      linearRunCosts: parameters.primaryRunCosts,
      utilityFactor: parameters.primaryUtilityFactor,
      value: parameters.minimumValue,
      points
    };
    const solve = await solveLinear_(highs, context, parameters.secondaryRunCosts, {
      ...state,
      onSolution(assignments, bound, gap) {
        if (parameters.primaryExactValue(assignments) + NUMERIC_EPSILON >= parameters.minimumValue) {
          state.onExactSolution?.(assignments, linearValue_(context, assignments, parameters.secondaryRunCosts), bound, gap);
        }
      }
    }, parameters.linearMinimums || [], [minimum]);
    totalNodes += solve.nodes;
    const primaryValue = parameters.primaryExactValue(solve.assignments);
    if (primaryValue + NUMERIC_EPSILON >= parameters.minimumValue) {
      return { ...solve, nodes: totalNodes, iterations, optimal: solve.optimal };
    }
    const totals = resourceTotalsFromAssignments_(context, solve.assignments);
    if (points.some(point => MATS.every(material => Math.abs((point[material] || 0) - totals[material]) <= NUMERIC_EPSILON))) {
      throw new Error("The nonlinear tie-break proof stalled before finding a feasible optimum.");
    }
    points.push(totals);
  }
}

function primaryTolerance_(value) {
  return PROOF_RELATIVE_GAP * Math.max(1, Math.abs(value));
}

function solverStats_(highs, state) {
  return {
    engine: "HiGHS WebAssembly",
    version: highs?.version?.string || SOLVER_PACKAGE_VERSION,
    nodes: state.nodes,
    iterations: state.iterations
  };
}

export async function optimizeCrazy(rawInput, options = {}) {
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
  const onProgress = options.onProgress || (() => {});
  const onCheckpoint = options.onCheckpoint || (() => {});
  const startedAt = performance.now();
  const context = buildContext_(input);

  const standard = optimize({ ...input, searchEffort: "standard" }, {
    onProgress(progress) { onProgress({ ...progress, phase: `standard-${progress.phase}`, elapsedMs: performance.now() - startedAt }); }
  });
  let checkpointAssignments = farmAssignmentsFromResult_(standard);
  let checkpointSummary = evaluateFarmAssignments_(context, checkpointAssignments).summary;
  const initialCheckpoint = finalizeResult_(context, checkpointAssignments, {
    solutionStatus: "best-found",
    upperBound: null,
    relativeGap: null,
    solverStats: { engine: "CIFI heuristic", version: "3.0.2", nodes: 0, iterations: standard.solverStats?.iterations || 0 },
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

  onProgress({ phase: "loading-solver", completed: 0, total: 1, elapsedMs: performance.now() - startedAt });
  const highs = await loadSolver_();
  const aggregate = { nodes: 0, iterations: 0 };
  let hybridIdeals = null;
  let primaryUpperBound = null;
  let primaryGap = 0;
  const kind = getModeKind(input.mode);

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
  const commonState = phase => ({ seed: solverSeed, phase, startedAt, onProgress, warmAssignments: checkpointAssignments });

  let finalAssignments = checkpointAssignments;
  if (kind === "academy" || kind === "completions") {
    const primaryCosts = runCosts_(context, kind);
    const primary = await solveLinear_(highs, context, primaryCosts, {
      ...commonState("crazy-primary"),
      onSolution: assignments => checkpoint(assignments)
    });
    aggregate.nodes += primary.nodes; aggregate.iterations++;
    const primaryValue = linearValue_(context, primary.assignments, primaryCosts);
    primaryUpperBound = primary.dualBound;
    primaryGap = relativeGap(primaryValue, primaryUpperBound) || 0;
    const secondaryKind = kind === "academy" ? "completions" : "fragments";
    const secondary = await solveLinear_(highs, context, runCosts_(context, secondaryKind), {
      ...commonState("crazy-tiebreak"),
      warmAssignments: primary.assignments,
      onSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    }, [{ runCosts: primaryCosts, value: primaryValue - primaryTolerance_(primaryValue) }]);
    aggregate.nodes += secondary.nodes; aggregate.iterations++;
    finalAssignments = secondary.assignments;
  } else if (kind === "fragments") {
    const fragmentCosts = runCosts_(context, "fragments");
    const primary = await solveLinear_(highs, context, fragmentCosts, {
      ...commonState("crazy-primary"),
      onSolution: assignments => checkpoint(assignments)
    });
    aggregate.nodes += primary.nodes; aggregate.iterations++;
    const fragmentIdeal = linearValue_(context, primary.assignments, fragmentCosts);
    primaryUpperBound = primary.dualBound;
    primaryGap = relativeGap(fragmentIdeal, primaryUpperBound) || 0;
    const secondary = await solveConcave_(highs, context, {
      runCosts: {}, utilityFactor: 1,
      linearMinimums: [{ runCosts: fragmentCosts, value: fragmentIdeal - primaryTolerance_(fragmentIdeal) }],
      exactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility
    }, {
      ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments,
      onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    });
    aggregate.nodes += secondary.nodes; aggregate.iterations += secondary.iterations;
    finalAssignments = secondary.assignments;
  } else if (kind === "resources") {
    const primary = await solveConcave_(highs, context, {
      runCosts: {}, utilityFactor: 1,
      exactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility
    }, {
      ...commonState("crazy-primary"),
      onExactSolution: (assignments, value, bound, gap) => checkpoint(assignments, bound, gap)
    });
    aggregate.nodes += primary.nodes; aggregate.iterations += primary.iterations;
    primaryUpperBound = primary.upperBound;
    primaryGap = primary.relativeGap;
    const secondary = await solveLinearWithConcaveMinimum_(highs, context, {
      primaryRunCosts: {}, primaryUtilityFactor: 1,
      primaryExactValue: assignments => evaluateFarmAssignments_(context, assignments).summary.resourceUtility,
      minimumValue: primary.value - primaryTolerance_(primary.value),
      secondaryRunCosts: runCosts_(context, "fragments")
    }, {
      ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments,
      onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
    });
    aggregate.nodes += secondary.nodes; aggregate.iterations += secondary.iterations;
    finalAssignments = secondary.assignments;
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
    hybridIdeals = { fragments: fragmentIdeal, resourceUtility: resourceIdeal, fragmentWeight, resourceWeight, proven: true };

    let fragmentFactor = 0;
    let utilityFactor = 0;
    if (fragmentIdeal <= NUMERIC_EPSILON && resourceIdeal <= NUMERIC_EPSILON) {
      const completion = await solveLinear_(highs, context, runCosts_(context, "completions"), {
        ...commonState("crazy-primary"),
        onSolution: assignments => checkpoint(assignments)
      });
      aggregate.nodes += completion.nodes; aggregate.iterations++;
      finalAssignments = completion.assignments;
      primaryUpperBound = completion.dualBound;
      primaryGap = relativeGap(linearValue_(context, finalAssignments, runCosts_(context, "completions")), primaryUpperBound) || 0;
    } else {
      if (fragmentIdeal <= NUMERIC_EPSILON) utilityFactor = 1 / resourceIdeal;
      else if (resourceIdeal <= NUMERIC_EPSILON) fragmentFactor = 1 / fragmentIdeal;
      else { fragmentFactor = fragmentWeight / fragmentIdeal; utilityFactor = resourceWeight / resourceIdeal; }
      const hybridRunCosts = Object.fromEntries(context.missions.map(mission => [mission.name, fragmentFactor * mission.fragmentYield]));
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
      primaryUpperBound = primary.upperBound ?? primary.dualBound;
      primaryGap = primary.relativeGap ?? relativeGap(primaryValue, primaryUpperBound) ?? 0;
      if (utilityFactor > 0) {
        const secondary = await solveLinearWithConcaveMinimum_(highs, context, {
          primaryRunCosts: hybridRunCosts,
          primaryUtilityFactor: utilityFactor,
          primaryExactValue: exactHybrid,
          minimumValue: primaryValue - primaryTolerance_(primaryValue),
          secondaryRunCosts: runCosts_(context, "completions")
        }, {
          ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments,
          onExactSolution: assignments => checkpoint(assignments, primaryUpperBound, primaryGap)
        });
        aggregate.nodes += secondary.nodes; aggregate.iterations += secondary.iterations;
        finalAssignments = secondary.assignments;
      } else {
        const secondary = await solveLinear_(highs, context, runCosts_(context, "completions"), {
          ...commonState("crazy-tiebreak"), warmAssignments: primary.assignments
        }, [{ runCosts: hybridRunCosts, value: primaryValue - primaryTolerance_(primaryValue) }]);
        aggregate.nodes += secondary.nodes; aggregate.iterations++;
        finalAssignments = secondary.assignments;
      }
    }
  }

  const finalSummary = evaluateFarmAssignments_(context, finalAssignments).summary;
  const finalPrimary = describeObjective(input.mode, finalSummary, hybridIdeals).primaryValue;
  primaryGap = relativeGap(finalPrimary, primaryUpperBound) ?? primaryGap;
  const result = finalizeResult_(context, finalAssignments, {
    solutionStatus: "optimal",
    upperBound: primaryUpperBound,
    relativeGap: primaryGap,
    solverStats: solverStats_(highs, aggregate),
    hybridIdeals,
    seed
  });
  onProgress({ phase: "complete", completed: 1, total: 1, nodes: aggregate.nodes, upperBound: primaryUpperBound, relativeGap: primaryGap, elapsedMs: performance.now() - startedAt });
  return result;
}

export { buildContext_ as buildCrazyContextForTest, evaluateFarmAssignments_ as evaluateCrazyAssignmentsForTest };
