import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_DATA, TYPE_ORDER } from "../src/data.js";
import { createDefaultInput, validateInput, calculateGlobalSpeedMultiplier } from "../src/validation.js";
import { optimize } from "../src/optimizer.js";
import { optimizeShorts, planShorts } from "../src/shorts-optimizer.js";
import { progressAtShortsStep } from "../src/shorts-progress.js";
import { createSavedState, sanitizePersistedInput } from "../src/state.js";
import { includeCampaignPrerequisites } from "../src/campaign-unlocks.js";

function fixture() {
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  input.campaignEnabled = true;
  input.shortsEnabled = true;
  input.selectedCampaignFarmMissions = [];
  input.workers["Mining Pod"] = { power: 10, count: 2500 };
  input.workers["Fireteam Carrier"] = { power: 25, count: 500 };
  input.shortsProgress.C1 = { completed: 8, target: 12, active: null };
  input.shortsProgress.C2 = { completed: 8, target: 12, active: null };
  input.shortsProgress.C3 = { completed: 8, target: 12, active: null };
  input.shortsProgress.C4 = { completed: 7, target: 8, active: null };
  return input;
}

test("Campaign Planner supports non-Ouroboros chains and enforces the available targets", async () => {
  const input = createDefaultInput();
  input.campaignEnabled = input.shortsEnabled = true;
  input.selectedCampaignFarmMissions = [];
  input.workers["Mining Pod"] = { power: 100, count: 2500 };
  input.shortsProgress.C3.target = 8;
  const result = await optimizeShorts(input);
  assert.match(result.modeUsed, /Campaign Planner/);
  assert.equal(result.shortsPlan.jobs.length, 24);
  assert.ok(result.shortsPlan.jobs.every(job => /^C[123]-[1-8]$/.test(job.name)));
  verifySchedule(input, result.shortsPlan);
  input.shortsProgress.C4.target = 1;
  input.shortsProgress.C1.target = 9;
  const errors = validateInput(input).errors;
  assert.ok(errors.some(error => error.field === "shorts-target-C4"));
  assert.ok(errors.some(error => error.field === "shorts-target-C1"));
});

function verifySchedule(input, plan) {
  input = { ...input, shortsProgress: includeCampaignPrerequisites(input.shortsProgress) };
  const speed = calculateGlobalSpeedMultiplier(input);
  for (const section of Object.keys(input.shortsProgress)) {
    const progress = input.shortsProgress[section];
    const jobs = plan.jobs.filter(job => job.section === section);
    assert.equal(jobs.length, progress.target - progress.completed);
    jobs.forEach((job, index) => {
      assert.equal(job.name, `${section}-${progress.completed + index + 1}`);
      if (index) assert.ok(job.startHours >= jobs[index - 1].endHours, "prerequisite finishes before launch");
    });
  }
  for (const job of plan.jobs) {
    if (job.prerequisite) assert.ok(job.startHours >= plan.jobs.find(prior => prior.name === job.prerequisite).endHours, "section unlock finishes before launch");
    assert.ok(Object.values(job.workers).every(value => Number.isInteger(value) && value >= 0));
    assert.ok(Object.values(job.workers).reduce((sum, count) => sum + count, 0) <= job.cap);
    if (!job.alreadyRunning) {
      const power = TYPE_ORDER.reduce((sum, type) => sum + job.workers[type] * input.workers[type].power, 0);
      const mission = MISSION_DATA.find(row => row.name === job.name);
      const expected = Math.max(2 / 3600, mission.minutes / 60 / speed / power);
      assert.ok(Math.abs((job.endHours - job.startHours) - expected) <= 1e-8 * expected);
    }
  }
  for (const step of plan.steps) {
    for (const type of TYPE_ORDER) {
      const busy = step.running.reduce((sum, job) => sum + job.workers[type], 0);
      assert.ok(busy <= plan.availableWorkers[type], `${type} double-booked at ${step.timeHours}`);
    }
  }
}

test("Shorts plans all four chronological chains with concurrency and no double-booked workers", async () => {
  const input = fixture();
  const result = await optimizeShorts(input);
  assert.equal(result.shortsPlan.status, "best-found");
  assert.equal(result.shortsPlan.jobs.length, 13);
  assert.ok(!result.notices.some(notice => notice.startsWith("No personnel could")));
  assert.ok(result.shortsPlan.steps.some(step => step.running.length > 1));
  verifySchedule(input, result.shortsPlan);
  const repeated = await optimizeShorts(input);
  assert.deepEqual(repeated.shortsPlan, result.shortsPlan);
  // The search includes a full-allocation baseline; its result must beat a serial route.
  const serial = result.shortsPlan.jobs.reduce((sum, job) => {
    const row = MISSION_DATA.find(mission => mission.name === job.name);
    let slots = job.cap;
    let power = 0;
    [...TYPE_ORDER].sort((a, b) => input.workers[b].power - input.workers[a].power).forEach(type => {
      const count = Math.min(slots, input.workers[type].count);
      slots -= count;
      power += count * input.workers[type].power;
    });
    return sum + Math.max(2 / 3600, row.minutes / 60 / power);
  }, 0);
  assert.ok(result.campaignETA <= serial);
});

test("farm allocation is unchanged by campaign targets, and farm workers are reserved at every step", async () => {
  const input = fixture();
  input.selectedFarmMissions = ["F1-1", "F1-2"];
  input.selectedCampaignFarmMissions = ["F1-1"];
  const result = await optimizeShorts(input);
  const farmOnly = optimize({ ...input, campaignEnabled: false, shortsEnabled: false, shortsProgress: undefined, selectedFarmMissions: ["F1-1"] });
  assert.deepEqual(result.assignments.filter(row => row.name.startsWith("F")), farmOnly.assignments);
  assert.deepEqual(result.totals, farmOnly.totals);
  verifySchedule(input, result.shortsPlan);
  input.shortsProgress.C1.target = 9;
  const changed = await optimizeShorts(input);
  assert.deepEqual(changed.assignments.filter(row => row.name.startsWith("F")), farmOnly.assignments);
});

test("resuming a completion carries unfinished campaigns and releases only finished workers", async () => {
  const input = fixture();
  const first = await optimizeShorts(input);
  const step = first.shortsPlan.steps.find(step => step.completed.length && step.running.some(job => job.startHours < step.timeHours));
  assert.ok(step);
  const progress = progressAtShortsStep(input.shortsProgress, first.shortsPlan, step.timeHours);
  const running = step.running.filter(job => job.startHours < step.timeHours);
  for (const job of running) {
    assert.deepEqual(progress[job.section].active.workers, job.workers);
    assert.equal(progress[job.section].active.remainingHours, job.endHours - step.timeHours);
  }
  input.shortsProgress = progress;
  input.modifiers.engineeringBadge = true;
  input.workers["Mining Pod"].count += 100;
  const resumed = await optimizeShorts(input);
  verifySchedule(input, resumed.shortsPlan);
  for (const job of running) {
    const retained = resumed.shortsPlan.jobs.find(row => row.name === job.name);
    assert.equal(retained.alreadyRunning, true);
    assert.equal(retained.endHours, job.endHours - step.timeHours);
    assert.deepEqual(retained.workers, job.workers);
  }
  const atEnd = progressAtShortsStep(input.shortsProgress, resumed.shortsPlan, resumed.shortsPlan.totalHours);
  assert.ok(Object.values(atEnd).every(row => row.completed === row.target && !row.active));
});

test("running campaigns reserve workers before farming, then return them on completion", async () => {
  const input = fixture();
  input.selectedCampaignFarmMissions = ["F1-1"];
  input.shortsProgress.C1.active = { remainingHours: 1, workers: { "Mining Pod": 750 } };
  const result = await optimizeShorts(input);
  verifySchedule(input, result.shortsPlan);
  assert.equal(result.shortsPlan.jobs[0].endHours, 1);
  assert.equal(result.shortsPlan.jobs[0].workers["Mining Pod"], 750);
});

test("empty targets finish immediately; zero-power leftovers report blocked", async () => {
  const input = createDefaultInput();
  input.campaignEnabled = input.shortsEnabled = true;
  input.selectedCampaignFarmMissions = [];
  assert.equal((await optimizeShorts(input)).campaignETA, 0);
  input.shortsProgress.C1.target = 1;
  input.workers["Mining Pod"] = { power: 0, count: 100 };
  const result = await optimizeShorts(input);
  assert.equal(result.shortsPlan.status, "blocked");
  assert.deepEqual(result.shortsPlan.unresolved, ["C1-1"]);
  assert.equal(result.campaignETA, Infinity);
});

test("waiting for a locked strong crew can beat immediately launching a weak crew", async () => {
  const input = fixture();
  input.shortsProgress = createDefaultInput().shortsProgress;
  input.shortsProgress.C1.target = 1;
  input.shortsProgress.C4.target = 1;
  input.workers["Mining Pod"] = { power: 0.0001, count: 5 };
  input.workers["Fireteam Carrier"] = { power: 100, count: 5 };
  input.shortsProgress.C4.active = { remainingHours: 1, workers: { "Fireteam Carrier": 5 } };
  const result = await optimizeShorts(input);
  assert.equal(result.shortsPlan.jobs.find(job => job.name === "C1-1").startHours, 1);
  assert.ok(result.campaignETA < 1.01);
  verifySchedule(input, result.shortsPlan);
});

test("farms can exhaust workers, and a single leftover worker completes sections serially", async () => {
  const input = createDefaultInput();
  input.campaignEnabled = input.shortsEnabled = true;
  input.selectedCampaignFarmMissions = ["F1-1"];
  input.workers["Mining Pod"] = { power: 1, count: 1 };
  input.shortsProgress.C1.target = 2;
  input.shortsProgress.C1.completed = 1;
  input.shortsProgress.C2.target = 2;
  const blocked = await optimizeShorts(input);
  assert.equal(blocked.shortsPlan.status, "blocked");
  assert.deepEqual(blocked.assignments, [{ name: "F1-1", type: "Mining Pod", count: 1 }]);
  input.selectedCampaignFarmMissions = [];
  const serial = await optimizeShorts(input);
  verifySchedule(input, serial.shortsPlan);
  assert.ok(serial.shortsPlan.steps.every(step => step.running.length <= 1));
});

test("capacity, speed modifiers, and two-second minimum are applied", () => {
  const input = fixture();
  input.shortsProgress = createDefaultInput().shortsProgress;
  input.shortsProgress.C1.target = 2;
  input.relic11Level = 2;
  input.modifiers.engineeringBadge = true;
  const available = Object.fromEntries(TYPE_ORDER.map(type => [type, input.workers[type].count]));
  const plan = planShorts(input, available);
  verifySchedule(input, plan);
  assert.equal(plan.jobs[0].cap, MISSION_DATA.find(row => row.name === "C1-1").cap * 2);
  input.workers["Mining Pod"].power = 1e12;
  const fast = planShorts(input, available);
  assert.equal(fast.totalHours, 4 / 3600);
  assert.equal(fast.jobs[0].workers["Mining Pod"], 1);
});

test("Shorts validation rejects locked targets, reversed ranges, impossible running allocations and bad timers", () => {
  const input = fixture();
  input.ouroUnlocked = false;
  assert.ok(validateInput(input).errors.some(error => error.field === "shorts-target-C4"));
  input.ouroUnlocked = true;
  input.shortsProgress.C1.target = 7;
  assert.ok(validateInput(input).errors.some(error => error.field === "shorts-target-C1"));
  input.shortsProgress.C1.target = 9;
  input.shortsProgress.C1.active = { remainingHours: -1, workers: { "Mining Pod": 3000 } };
  const errors = validateInput(input).errors;
  assert.ok(errors.some(error => error.field === "shorts-hours-C1"));
  assert.ok(errors.some(error => error.field === "shorts-running-C1"));
  assert.ok(errors.some(error => error.field === "worker-count-Mining Pod"));
  input.shortsEnabled = false;
  assert.equal(validateInput(input).errors.length, 0);
});

test("saved settings preserve targets and active workers; older settings get empty progress", () => {
  const input = fixture();
  input.shortsProgress.C1.active = { remainingHours: 0.75, workers: { "Mining Pod": 100 } };
  const expected = validateInput(input).input;
  assert.deepEqual(createSavedState(input).input, expected);
  assert.deepEqual(sanitizePersistedInput({}).shortsProgress, createDefaultInput().shortsProgress);
  const broken = fixture();
  broken.shortsProgress.C1 = { completed: -4, target: 999, active: { remainingHours: "invalid", workers: { "Mining Pod": 9e30 } } };
  const repaired = sanitizePersistedInput(broken);
  assert.equal(repaired.shortsProgress.C1.completed, 0);
  assert.equal(repaired.shortsProgress.C1.target, 12);
  assert.equal(repaired.shortsProgress.C1.active, null);
  assert.deepEqual(validateInput(repaired).errors, []);
});

test("old single-campaign settings migrate to planner targets without inventing completions", () => {
  const legacy = createDefaultInput();
  legacy.campaignEnabled = true;
  legacy.campaignTargetName = "C3-5";
  const migrated = sanitizePersistedInput(legacy);
  assert.equal(migrated.shortsEnabled, true);
  assert.equal(migrated.shortsProgress.C3.target, 5);
  assert.ok(Object.values(migrated.shortsProgress).every(progress => progress.completed === 0 && progress.active === null));
  assert.deepEqual(migrated.workers, legacy.workers);
  assert.deepEqual(migrated.selectedCampaignFarmMissions, legacy.selectedCampaignFarmMissions);
  assert.deepEqual(validateInput(migrated).errors, []);
  migrated.campaignEnabled = false;
  const disabled = sanitizePersistedInput(migrated);
  assert.equal(disabled.shortsEnabled, false);
  assert.equal(disabled.shortsProgress.C3.target, 5);
});

test("Overkill uses Shorts scheduling after optimising farms", async () => {
  const input = fixture();
  input.searchEffort = "crazy";
  const result = await optimizeShorts(input);
  assert.ok(result.shortsPlan);
  assert.equal(result.solutionStatus, "best-found", "farm optimality must not imply route optimality");
  verifySchedule(input, result.shortsPlan);
});
