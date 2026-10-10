import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrazyContextForTest,
  certifyBoundForTest,
  evaluateCrazyAssignmentsForTest,
  maxResourceTotalsForTest,
  missionRunUpperBoundForTest,
  optimizeCrazy,
  rebalanceCrazyAssignmentsForTest,
  workerMissionUpperBoundForTest
} from "../src/crazy-optimizer.js";
import { MISSION_DATA } from "../src/data.js";
import { describeObjective, PROOF_RELATIVE_GAP, relativeGap } from "../src/objective.js";
import { optimize } from "../src/optimizer.js";
import { createDefaultInput } from "../src/validation.js";

test("personnel removed from a speed-capped mission are reassigned productively", () => {
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.mode = "Fragments";
  input.fragmentsPerCompletion = 1;
  input.selectedFarmMissions = ["F1-1", "F4-2"];
  input.workers["Mining Pod"] = { power: 1000, count: 4 };
  const context = buildCrazyContextForTest(input);

  const assignments = rebalanceCrazyAssignmentsForTest(context, [
    { name: "F1-1", type: "Mining Pod", count: 4 }
  ], null);

  assert.deepEqual(assignments, [
    { name: "F1-1", type: "Mining Pod", count: 1 },
    { name: "F4-2", type: "Mining Pod", count: 3 }
  ]);
  assert.equal(assignments.reduce((sum, assignment) => sum + assignment.count, 0), 4);
});

test("Overkill bounds exclude personnel and mission output that cannot be useful", () => {
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.selectedFarmMissions = ["F1-1", "F4-2"];
  input.workers["Mining Pod"] = { power: 1000, count: 4 };
  const context = buildCrazyContextForTest(input);
  const fastMission = context.missions.find(mission => mission.name === "F1-1");
  const slowMission = context.missions.find(mission => mission.name === "F4-2");
  const worker = context.workers.find(candidate => candidate.type === "Mining Pod");

  assert.equal(workerMissionUpperBoundForTest(fastMission, worker), 1);
  assert.equal(missionRunUpperBoundForTest(context, fastMission), 1800);
  assert.ok(missionRunUpperBoundForTest(context, slowMission) < 1);
  assert.ok(maxResourceTotalsForTest(context).Chromium < 8000);
});

// Build a campaign example with stronger and weaker personnel.
function campaignStrengthInput() {
  const input = createDefaultInput();
  input.campaignEnabled = true;
  input.campaignTargetName = "C1-1";
  input.selectedCampaignFarmMissions = [];
  input.workers["Mining Pod"] = { power: 1, count: 10 };
  input.workers["Combat Corvette"] = { power: 100, count: 10 };
  return input;
}

// Check that campaign slots go to the strongest available personnel.
function assertStrongestCampaignPersonnel(result) {
  assert.deepEqual(result.assignments.filter(assignment => assignment.name === "C1-1"), [
    { name: "C1-1", type: "Combat Corvette", count: 5 }
  ]);
  assert.equal(result.unassignedWorkers["Mining Pod"], 10);
  assert.equal(result.unassignedWorkers["Combat Corvette"], 5);
}

test("standard campaign allocation uses the strongest remaining personnel", () => {
  assertStrongestCampaignPersonnel(optimize(campaignStrengthInput()));
});

test("Overkill campaign allocation uses the strongest remaining personnel", async () => {
  assertStrongestCampaignPersonnel(await optimizeCrazy({ ...campaignStrengthInput(), searchEffort: "crazy" }));
});

// Build a small example whose best allocation can be checked exhaustively.
function tinyExactInput(mode) {
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.searchEffort = "crazy";
  input.mode = mode;
  input.fragmentsPerCompletion = 0.05;
  input.hybridFragmentPercent = 60;
  input.selectedFarmMissions = ["F1-1", "F3-4"];
  input.workers["Mining Pod"] = { power: 3, count: 2 };
  input.workers["Fireteam Carrier"] = { power: 11, count: 2 };
  return input;
}

// List every allowed placement for the small test example.
function enumerateTinyAssignments(input) {
  const missions = input.selectedFarmMissions;
  const types = ["Mining Pod", "Fireteam Carrier"];
  let candidates = [[]];
  types.forEach(type => {
    const expanded = [];
    const count = input.workers[type].count;
    for (let first = 0; first <= count; first++) {
      for (let second = 0; second <= count - first; second++) {
        const additions = [];
        if (first > 0) additions.push({ name: missions[0], type, count: first });
        if (second > 0) additions.push({ name: missions[1], type, count: second });
        candidates.forEach(candidate => expanded.push([...candidate, ...additions]));
      }
    }
    candidates = expanded;
  });
  return candidates;
}

// Check whole personnel counts, available totals, and mission limits.
function assertAllocationInvariants(input, result) {
  const missionCaps = Object.fromEntries(MISSION_DATA.map(mission => [mission.name, mission.cap]));
  const assignedByType = {};
  const assignedByMission = {};
  result.assignments.filter(assignment => assignment.name.startsWith("F")).forEach(assignment => {
    assert.ok(Number.isInteger(assignment.count) && assignment.count > 0);
    assignedByType[assignment.type] = (assignedByType[assignment.type] || 0) + assignment.count;
    assignedByMission[assignment.name] = (assignedByMission[assignment.name] || 0) + assignment.count;
  });
  Object.entries(assignedByType).forEach(([type, count]) => assert.ok(count <= input.workers[type].count));
  Object.entries(assignedByMission).forEach(([mission, count]) => assert.ok(count <= missionCaps[mission]));
}

test("Overkill matches exhaustive tiny-instance primary objectives", async () => {
  const modes = ["Max Completions", "Academy Points", "Fragments", "Maximising Resources", "Fragments + Resources"];
  for (const mode of modes) {
    const input = tinyExactInput(mode);
    const context = buildCrazyContextForTest(input);
    const candidates = enumerateTinyAssignments(input).map(assignments => ({
      assignments,
      summary: evaluateCrazyAssignmentsForTest(context, assignments).summary
    }));
    const fragmentIdeal = Math.max(...candidates.map(candidate => candidate.summary.fragments));
    const resourceIdeal = Math.max(...candidates.map(candidate => candidate.summary.resourceUtility));
    const ideals = mode === "Fragments + Resources" ? {
      fragments: fragmentIdeal,
      resourceUtility: resourceIdeal,
      fragmentWeight: input.hybridFragmentPercent / 100,
      resourceWeight: 1 - input.hybridFragmentPercent / 100,
      proven: true
    } : null;
    const exactPrimary = Math.max(...candidates.map(candidate => describeObjective(mode, candidate.summary, ideals).primaryValue));

    const result = await optimizeCrazy(input);
    const resultContext = buildCrazyContextForTest(input);
    const resultSummary = evaluateCrazyAssignmentsForTest(
      resultContext,
      result.assignments.filter(assignment => assignment.name.startsWith("F"))
    ).summary;
    const resultPrimary = describeObjective(mode, resultSummary, ideals).primaryValue;
    const shortfall = relativeGap(resultPrimary, exactPrimary);

    assert.ok(shortfall != null && shortfall <= PROOF_RELATIVE_GAP, `${mode} primary shortfall ${shortfall}`);
    assertAllocationInvariants(input, result);
  }
});

test("tiny positive objectives retain relative accuracy and contradictory bounds are rejected", () => {
  assert.ok(Math.abs(relativeGap(1e-12, 2e-12) - 1) < 1e-12);
  assert.equal(relativeGap(0, 0), 0);
  assert.equal(relativeGap(0, 1e-20), null);
  assert.equal(relativeGap(1, 0.8), null);
  assert.equal(certifyBoundForTest(1, 0.8), null);
  assert.equal(certifyBoundForTest(0, 1e-20), null);
  assert.equal(certifyBoundForTest(1e-12, 2e-12), null);
  assert.ok(certifyBoundForTest(1e-12, 1e-12));
});

test("zero-output and fully capped farms retain valid certificates and campaign remainder", async () => {
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.searchEffort = "crazy";
  input.mode = "Fragments + Resources";
  input.selectedFarmMissions = ["F1-4", "F3-4"];
  input.workers["Mining Pod"] = { power: 10, count: 3 };
  const zeroRewards = await optimizeCrazy(input);
  assert.equal(zeroRewards.solutionStatus, "tolerance-met");
  assert.ok(zeroRewards.totals.Completions > 0);
  assert.equal(zeroRewards.hybridIdeals.fragments, 0);
  assert.equal(zeroRewards.hybridIdeals.resourceUtility, 0);

  input.selectedFarmMissions = ["F1-1"];
  input.selectedCampaignFarmMissions = ["F1-1"];
  input.campaignEnabled = true;
  input.campaignTargetName = "C1-1";
  input.workers["Mining Pod"] = { power: 1000, count: 100 };
  input.fragmentsPerCompletion = 0.001;
  const capped = await optimizeCrazy(input);
  assert.equal(capped.solutionStatus, "tolerance-met");
  assert.equal(capped.totals.Completions, 1800);
  assert.equal(capped.assignments.find(a => a.name === "F1-1").count, 1);
  assert.equal(capped.campaignAssigned, 5);
  assert.equal(capped.unassignedWorkers["Mining Pod"], 94);
  assert.ok(capped.objective.relativeGap <= PROOF_RELATIVE_GAP);
});

test("late-game fragment and hybrid optima are invariant to fragment yield scale", async () => {
  for (const fragments of [0.001, 1e-12, 1000]) {
    const input = createDefaultInput();
    input.ouroUnlocked = true;
    input.searchEffort = "crazy";
    input.selectedFarmMissions = ["F4-3", "F3-2"];
    input.workers["Mining Pod"] = { count: 3, power: 1 };
    input.workers["Fireteam Carrier"] = { count: 1, power: 1 };
    input.weights.Exon = 10;
    input.fragmentsPerCompletion = fragments;
    input.hybridFragmentPercent = 25;
    input.mode = "Fragments";
    const exactFragments = 4 * 60 / 975000 * fragments;
    const fragmentResult = await optimizeCrazy(input);
    assert.ok(relativeGap(fragmentResult.totals.Fragments, exactFragments) <= PROOF_RELATIVE_GAP);
    assert.ok(fragmentResult.assignments.every(a => a.name === "F3-2"));
    assert.equal(fragmentResult.solutionStatus, "tolerance-met");
    input.mode = "Fragments + Resources";
    const hybrid = await optimizeCrazy(input);
    assert.ok(relativeGap(hybrid.hybridIdeals.fragments, exactFragments) <= PROOF_RELATIVE_GAP);
    assert.ok(hybrid.hybridIdeals.fragmentUpperBound >= exactFragments);
    assert.ok(hybrid.assignments.every(a => a.name === "F4-3"));
    assert.ok(Math.abs(hybrid.objective.primaryValue - 0.775) < 1e-8);
    assert.equal(hybrid.solutionStatus, "tolerance-met");
    assert.ok(hybrid.objective.relativeGap <= PROOF_RELATIVE_GAP);
    assertAllocationInvariants(input, hybrid);
  }
});

test("fragment scaling preserves searches and restores reward units in every mode and checkpoint", async () => {
  for (const mode of ["Fragments", "Maximising Resources", "Max Completions", "Fragments + Resources", "Academy Points"]) {
    let reference = null;
    for (const fragments of [1, 0.7974, 0.7974334, 1e-12, 1000]) {
      const input = tinyExactInput(mode);
      input.fragmentsPerCompletion = fragments;
      const checkpoints = [];
      const progress = [];
      const result = await optimizeCrazy(input, {
        onCheckpoint: checkpoint => checkpoints.push(checkpoint),
        onProgress: event => progress.push(event)
      });
      assert.equal(result.solutionStatus, "tolerance-met");
      for (const candidate of [...checkpoints, result]) {
        const evaluated = evaluateCrazyAssignmentsForTest(buildCrazyContextForTest(input), candidate.assignments);
        for (const [reward, expected] of Object.entries(evaluated.totals)) {
          assert.ok(Math.abs(candidate.totals[reward] - expected) <= 1e-12 * Math.max(Math.abs(expected), 1e-300), `${mode}: ${reward}`);
        }
        const objective = describeObjective(mode, evaluated.summary, candidate.hybridIdeals);
        for (const key of ["primaryValue", "secondaryValue"]) {
          assert.ok(Math.abs(candidate.objective[key] - objective[key]) <= 1e-12 * Math.max(Math.abs(objective[key]), 1e-300));
        }
      }
      assert.equal(progress.at(-1).upperBound, result.objective.upperBound);
      if (reference) {
        assert.deepEqual(result.assignments, reference.assignments);
        assert.deepEqual(result.solverStats, reference.solverStats);
        assert.notEqual(result.runId, reference.runId);
        const boundScale = mode === "Fragments" ? fragments : 1;
        assert.ok(Math.abs(result.objective.upperBound - reference.objective.upperBound * boundScale) <= 1e-12 * Math.max(result.objective.upperBound, 1e-300));
        if (result.hybridIdeals) {
          assert.equal(result.hybridIdeals.fragments, reference.hybridIdeals.fragments * fragments);
          assert.equal(result.hybridIdeals.fragmentUpperBound, reference.hybridIdeals.fragmentUpperBound * fragments);
        }
      }
      reference ||= result;
    }
  }
});
