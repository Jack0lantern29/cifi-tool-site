import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCrazyContextForTest,
  evaluateCrazyAssignmentsForTest,
  maxResourceTotalsForTest,
  missionRunUpperBoundForTest,
  optimizeCrazy,
  rebalanceCrazyAssignmentsForTest,
  workerMissionUpperBoundForTest
} from "../src/crazy-optimizer.js";
import { MISSION_DATA } from "../src/data.js";
import { describeObjective, PROOF_RELATIVE_GAP } from "../src/objective.js";
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

function campaignStrengthInput() {
  const input = createDefaultInput();
  input.campaignEnabled = true;
  input.campaignTargetName = "C1-1";
  input.selectedCampaignFarmMissions = [];
  input.workers["Mining Pod"] = { power: 1, count: 10 };
  input.workers["Combat Corvette"] = { power: 100, count: 10 };
  return input;
}

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
    const shortfall = Math.max(0, exactPrimary - resultPrimary) / Math.max(1, Math.abs(resultPrimary));

    assert.ok(shortfall <= PROOF_RELATIVE_GAP * 3 + 1e-9, `${mode} primary shortfall ${shortfall}`);
    assertAllocationInvariants(input, result);
  }
});
