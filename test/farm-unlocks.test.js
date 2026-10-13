import assert from "node:assert/strict";
import test from "node:test";
import { TYPE_ORDER, farmUnlockCampaign } from "../src/data.js";
import { createDefaultInput, getVisibleFarmNames, validateInput } from "../src/validation.js";
import { optimize } from "../src/optimizer.js";
import { optimizeCrazy } from "../src/crazy-optimizer.js";
import { optimizeShorts } from "../src/shorts-optimizer.js";
import { progressAtShortsStep } from "../src/shorts-progress.js";
import { checkFarmReservationHorizon } from "../src/farm-reservations.js";

function inputForUnlocks() {
  const input = createDefaultInput();
  input.ouroUnlocked = input.campaignEnabled = input.shortsEnabled = true;
  input.workers["Mining Pod"] = { count: 1000, power: 10000 };
  input.selectedFarmMissions = input.selectedCampaignFarmMissions = ["F1-1", "F1-2", "F1-3", "F1-4", "F2-1", "F2-2", "F2-3"];
  input.shortsProgress.C1.target = 4;
  input.shortsProgress.C2.target = 4;
  return input;
}

test("farm visibility follows completion thresholds independently for all sections", () => {
  for (let section = 1; section <= 4; section++) {
    const progress = createDefaultInput().shortsProgress;
    for (const [completed, count] of [[0, 0], [1, 1], [2, 1], [3, 2], [4, 3], [11, 3], [12, 4]]) {
      progress[`C${section}`].completed = completed;
      assert.deepEqual(getVisibleFarmNames(true, progress), Array.from({ length: count }, (_, index) => `F${section}-${index + 1}`));
    }
  }
  assert.equal(farmUnlockCampaign("F4-4"), "C4-12");
  const progress = createDefaultInput().shortsProgress;
  progress.C1.target = 4;
  assert.deepEqual(getVisibleFarmNames(true, progress), []);
  assert.deepEqual(getVisibleFarmNames(true, progress, true), ["F1-1", "F1-2", "F1-3"]);
  progress.C4.completed = 12;
  assert.deepEqual(getVisibleFarmNames(false, progress), []);
});

test("unlocked farms start at their campaign completion without borrowing locked workers", async () => {
  const input = inputForUnlocks();
  const result = await optimizeShorts(input);
  const plan = result.shortsPlan;
  assert.equal(plan.status, "best-found");
  assert.equal(result.selectedFarmCount, 0);
  assert.ok(result.assignments.every(row => row.name.startsWith("C")));
  assert.equal(plan.farmEvents.length, 6);
  assert.ok(!plan.futureFarmNames.includes("F1-4"), "out-of-target unlocks are not reserved");
  for (const farm of plan.farmEvents) {
    assert.equal(farm.timeHours, plan.jobs.find(job => job.name === farm.unlockCampaign).endHours);
    assert.ok(Object.values(farm.workers).some(count => count > 0));
    assert.ok(plan.steps.find(step => step.timeHours === farm.timeHours).farmStarts.includes(farm));
  }
  for (const step of plan.steps) {
    for (const type of TYPE_ORDER) {
      const farming = plan.farmEvents.filter(farm => farm.timeHours <= step.timeHours).reduce((sum, farm) => sum + farm.workers[type], 0);
      const campaigns = step.running.reduce((sum, job) => sum + job.workers[type], 0);
      assert.ok(farming + campaigns <= input.workers[type].count);
    }
  }
  const resume = plan.steps.find(step => step.farmStarts.length);
  input.shortsProgress = progressAtShortsStep(input.shortsProgress, plan, resume.timeHours);
  const continued = await optimizeShorts(input);
  assert.ok(continued.selectedFarmNames.includes(resume.farmStarts[0].name));
  assert.ok(!continued.shortsPlan.farmEvents.some(farm => farm.name === resume.farmStarts[0].name), "resuming does not unlock the same farm twice");
});

test("a long campaign cannot consume workers needed by an earlier farm unlock", () => {
  const free = Object.fromEntries(TYPE_ORDER.map(type => [type, type === "Mining Pod" ? 5 : 0]));
  const crew = count => ({ ...free, "Mining Pod": count });
  const running = [{ name: "C1-1", workers: crew(5), endHours: 1 }];
  const candidate = { name: "C2-1", workers: crew(5), endHours: 10 };
  const reservations = { "C1-1": [{ name: "F1-1", type: "Mining Pod", count: 8 }] };
  const check = checkFarmReservationHorizon(free, running, candidate, reservations);
  assert.equal(check.feasible, false);
  assert.equal(check.timeHours, 1);
  assert.equal(check.remaining["Mining Pod"], -3);
  assert.equal(checkFarmReservationHorizon(free, running, { ...candidate, workers: crew(2) }, reservations).feasible, true);
});

test("existing locked crews that prevent immediate farm staffing are reported as blocked", async () => {
  const input = inputForUnlocks();
  input.workers["Mining Pod"] = { count: 10, power: 1 };
  input.selectedCampaignFarmMissions = ["F1-1"];
  input.shortsProgress.C1 = { completed: 0, target: 1, active: { remainingHours: 1, workers: { "Mining Pod": 1 } } };
  input.shortsProgress.C2.target = 0;
  input.shortsProgress.C4 = { completed: 0, target: 1, active: { remainingHours: 10, workers: { "Mining Pod": 9 } } };
  const result = await optimizeShorts(input);
  assert.equal(result.shortsPlan.status, "blocked");
  assert.equal(result.shortsPlan.farmBlockedAt, 1);
  assert.deepEqual(result.shortsPlan.farmEvents, []);
  assert.ok(result.notices.some(notice => notice.includes("prevent a required farm")));
});

test("deselected future farms do not reserve workers or appear in the plan", async () => {
  const input = inputForUnlocks();
  input.selectedCampaignFarmMissions = ["F1-1"];
  const result = await optimizeShorts(input);
  assert.deepEqual(result.shortsPlan.farmEvents.map(farm => farm.name), ["F1-1"]);
});

test("Shorts farm selections survive an empty main selector, including farms beyond the target", async () => {
  const input = inputForUnlocks();
  input.selectedFarmMissions = [];
  input.selectedCampaignFarmMissions = ["F1-1", "F1-2", "F1-3", "F1-4"];
  assert.deepEqual(validateInput(input).input.selectedCampaignFarmMissions, input.selectedCampaignFarmMissions);
  const result = await optimizeShorts(input);
  assert.deepEqual(result.shortsPlan.futureFarmNames, ["F1-1", "F1-2", "F1-3"]);
  assert.deepEqual(result.shortsPlan.farmEvents.map(farm => farm.name), ["F1-1", "F1-2", "F1-3"]);
  assert.deepEqual(input.selectedFarmMissions, []);
});

test("standard and Overkill campaign farms are independent of the main selector", async () => {
  const input = inputForUnlocks();
  input.shortsEnabled = false;
  input.campaignTargetName = "C1-2";
  input.selectedFarmMissions = [];
  input.selectedCampaignFarmMissions = ["F1-1"];
  for (const result of [optimize(input), await optimizeCrazy(input)]) {
    assert.deepEqual(result.selectedFarmNames, ["F1-1"]);
    assert.ok(result.assignments.some(row => row.name === "F1-1" && row.count > 0));
  }
});
