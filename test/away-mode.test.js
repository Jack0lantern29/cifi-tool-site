import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_DATA, TYPE_ORDER } from "../src/data.js";
import { createDefaultInput, validateInput } from "../src/validation.js";
import { sanitizePersistedInput } from "../src/state.js";
import { optimizeShorts } from "../src/shorts-optimizer.js";
import { createTracker, transitionTracker, trackerActions, trackerFreeWorkers, campaignStartProblem, prepareTrackerUpdate, mergeTrackerUpdate, validateTracker } from "../src/shorts-tracker.js";
import { awayHoursRemaining } from "../src/away-mode.js";

const now = Date.parse("2026-10-17T12:00:00Z");
const hour = 3600000;
function fixture() {
  const input = createDefaultInput();
  Object.assign(input, { ouroUnlocked: true, campaignEnabled: true, shortsEnabled: true, awayEnabled: true, awayUntil: now + 8 * hour });
  input.selectedCampaignFarmMissions = [];
  input.workers["Mining Pod"] = { power: 3200000 / 30, count: 10 };
  input.shortsProgress.C1 = { completed: 8, target: 9, active: null };
  input.shortsProgress.C4.target = 1;
  return input;
}
const solve = input => optimizeShorts(input, { plannedAt: now });

test("complete away planner matches an independent two-mission allocation oracle", async () => {
  for (const count of [1, 2, 3]) for (const away of [1, 4, 10]) {
    const input = fixture();
    input.awayUntil = now + away * hour;
    input.workers[TYPE_ORDER[0]] = { power: 1000000, count };
    input.workers[TYPE_ORDER[1]] = { power: 3000000, count: 1 };
    const work = ["C1-9", "C4-1"].map(name => MISSION_DATA.find(job => job.name === name).minutes / 60);
    const duration = (index, pods, carriers) => pods + carriers ? work[index] / (pods * 1000000 + carriers * 3000000) : Infinity;
    let optimum = Math.min(Math.max(away, duration(0, count, 1)) + duration(1, count, 1), Math.max(away, duration(1, count, 1)) + duration(0, count, 1));
    for (let pods = 0; pods <= count; pods++) for (let carriers = 0; carriers <= 1; carriers++) {
      optimum = Math.min(optimum, Math.max(away, duration(0, pods, carriers), duration(1, count - pods, 1 - carriers)));
    }
    const result = await solve(input);
    assert.ok(Math.abs(result.shortsPlan.totalHours - optimum) < 1e-8, JSON.stringify({ count, away, optimum, actual: result.shortsPlan.totalHours }));
    let state = createTracker(result, input, now);
    for (const job of trackerActions(state, now).ready) state = transitionTracker(state, { type: "start", name: job.name }, now);
    assert.ok(Object.values(trackerFreeWorkers(state)).every(value => value >= 0));
    validateTracker(JSON.parse(JSON.stringify(state)));
  }
});

test("reported C3-11 crew and future farm selections launch C2-9 before return", async () => {
  // C3 crew supplied by the user. The farm split is inferred, not confirmed:
  // it accounts exactly for the totals minus running crews and reported spares.
  // Times are reconstructed from C1's entered timer and the live tracker ETAs.
  const plannedAt = Date.parse("2026-10-17T11:28:25Z");
  const awayUntil = Date.parse("2026-10-17T21:30:00Z");
  const counts = values => Object.fromEntries(TYPE_ORDER.map((type, index) => [type, values[index]]));
  const reservedFarms = [
    { name: "F1-1", type: "Fireteam Carrier", count: 1 },
    { name: "F1-2", type: "Combat Corvette", count: 3 },
    { name: "F1-3", type: "Combat Corvette", count: 18 },
    { name: "F2-1", type: "Mining Pod", count: 1 },
    { name: "F2-1", type: "Combat Corvette", count: 1 },
    { name: "F2-2", type: "Combat Corvette", count: 18 },
    { name: "F3-1", type: "Fireteam Carrier", count: 1 },
    { name: "F3-1", type: "Combat Corvette", count: 22 }
  ];
  for (const searchEffort of ["standard", "crazy"]) {
    const input = fixture();
    // Keep existing tracked farms reserved even if omitted from the new choices.
    // A positive fragment yield is normalised here; its exact value was not
    // supplied. It gives the selected F1-4 and F2-4 farms their intended output.
    Object.assign(input, { searchEffort, relic11Level: 3, awayUntil, mode: "Fragments", fragmentsPerCompletion: 1,
      selectedCampaignFarmMissions: ["F1-4", "F2-1", "F2-2", "F2-4", "F3-1", "F4-1"] });
    [[6.5, 11615], [13, 6380], [22, 3069], [41, 2007]].forEach(([power, count], index) => { input.workers[TYPE_ORDER[index]] = { power, count }; });
    Object.assign(input.modifiers, { engineeringBadge: true, swarmLevel: 40, productivityLevel: 11, research58: 6, research70: 6, research80: 2, relic3: 40, ts07Enabled: true });
    [[8, 12], [8, 12], [10, 12], [0, 8]].forEach(([completed, target], index) => { input.shortsProgress[`C${index + 1}`] = { completed, target, active: null }; });
    input.shortsProgress.C1.active = { workers: counts([0, 936, 56, 0]), remainingHours: (2 * 3600 + 22 * 60 + 51) / 3600 };
    input.shortsProgress.C3.active = { workers: counts([10898, 5313, 3011, 1530]), remainingHours: (9 * 3600 + 53 * 60 + 8) / 3600 };
    const initialFree = Object.fromEntries(TYPE_ORDER.map(type => [type, input.workers[type].count - input.shortsProgress.C1.active.workers[type] - input.shortsProgress.C3.active.workers[type] - reservedFarms.filter(row => row.type === type).reduce((sum, row) => sum + row.count, 0)]));
    assert.deepEqual(initialFree, counts([716, 129, 2, 415]));
    const result = await optimizeShorts(input, { plannedAt, reservedFarms });
    assert.deepEqual(result.assignments.filter(row => row.name.startsWith("F")), reservedFarms);
    assert.equal(result.shortsPlan.status, "best-found");
    assert.deepEqual([...result.shortsPlan.futureFarmNames].sort(), ["F1-4", "F2-4", "F4-1"]);
    for (const farm of result.shortsPlan.farmEvents) {
      assert.equal(farm.timeHours, result.shortsPlan.jobs.find(job => job.name === farm.unlockCampaign).endHours);
      assert.ok(farm.timeHours >= (awayUntil - plannedAt) / hour);
    }
    for (const step of result.shortsPlan.steps) for (const type of TYPE_ORDER) {
      const currentFarms = reservedFarms.filter(row => row.type === type).reduce((sum, row) => sum + row.count, 0);
      const futureFarms = result.shortsPlan.farmEvents.filter(farm => farm.timeHours <= step.timeHours).reduce((sum, farm) => sum + farm.workers[type], 0);
      const running = step.running.reduce((sum, job) => sum + job.workers[type], 0);
      assert.ok(currentFarms + futureFarms + running <= input.workers[type].count);
    }
    const launch = result.shortsPlan.jobs.find(job => job.name === "C2-9");
    assert.equal(launch.startHours, 0);
    assert.ok(launch.finishHours <= (awayUntil - plannedAt) / hour);
    for (const section of ["C1", "C3"]) {
      const job = result.shortsPlan.jobs.find(job => job.section === section && job.alreadyRunning);
      assert.deepEqual(job.workers, input.shortsProgress[section].active.workers);
      assert.equal(job.finishHours, input.shortsProgress[section].active.remainingHours);
    }
    let state = createTracker(result, input, plannedAt);
    const ready = trackerActions(state, plannedAt).ready;
    assert.ok(ready.some(job => job.name === "C2-9"));
    for (const job of ready) state = transitionTracker(state, { type: "start", name: job.name }, plannedAt);
    assert.ok(Object.values(trackerFreeWorkers(state)).every(value => value >= 0));
    validateTracker(JSON.parse(JSON.stringify(state)));
    const request = prepareTrackerUpdate(state, input, plannedAt + hour);
    const replanned = await optimizeShorts(request.input, { plannedAt: request.startedAt, reservedFarms: request.reservedFarms });
    const updated = mergeTrackerUpdate(state, replanned, request.input, request.startedAt, plannedAt + hour);
    assert.deepEqual(updated.missions["C2-9"].workers, state.missions["C2-9"].workers);
    assert.equal(updated.missions["C2-9"].endsAt, state.missions["C2-9"].endsAt);
    assert.deepEqual(updated.farms, state.farms);
    validateTracker(updated);
  }
});

test("away plan splits two short campaigns across the absence instead of serial launches while asleep", async () => {
  const input = fixture();
  const normal = await solve({ ...input, awayEnabled: false });
  const result = await solve(input);
  const plan = result.shortsPlan;
  assert.equal(plan.awayHours, 8);
  assert.equal(plan.totalHours, 8);
  assert.equal(plan.jobs.length, 2);
  assert.ok(plan.jobs.every(job => job.startHours === 0));
  assert.ok(plan.jobs.every(job => job.finishHours <= 8 && job.endHours === 8));
  assert.ok(plan.jobs.some(job => job.finishHours > 3), "slower concurrent missions use the time away");
  assert.ok(normal.shortsPlan.totalHours < 8, "normal mode still assumes immediate restarts");
  assert.ok(plan.certificate.lowerBoundHours <= plan.totalHours);
  let state = createTracker(result, input, now);
  const starts = trackerActions(state, now).ready;
  assert.equal(starts.length, 2);
  for (const job of starts) state = transitionTracker(state, { type: "start", name: job.name }, now);
  for (const job of plan.jobs) assert.equal(state.missions[job.name].durationMs, Math.ceil(job.finishHours * hour));
  assert.ok(Object.values(trackerFreeWorkers(state)).every(value => value >= 0));
  validateTracker(JSON.parse(JSON.stringify(state)));
});

test("no later campaigns or newly unlocked farms start during the absence", async () => {
  const input = fixture();
  input.shortsProgress.C1.target = 10;
  input.shortsProgress.C4.target = 2;
  input.selectedCampaignFarmMissions = ["F4-1"];
  const result = await solve(input);
  const plan = result.shortsPlan;
  assert.equal(plan.status, "best-found");
  for (const job of plan.jobs) assert.ok(job.startHours === 0 || job.startHours >= 8);
  assert.ok(plan.farmEvents.every(farm => farm.timeHours >= 8));
  for (const step of plan.steps) for (const type of TYPE_ORDER) {
    const farms = plan.farmEvents.filter(farm => farm.timeHours <= step.timeHours).reduce((sum, farm) => sum + farm.workers[type], 0);
    assert.ok(farms + step.running.reduce((sum, job) => sum + job.workers[type], 0) <= input.workers[type].count);
  }
});

test("imported timers remain real and replanning keeps the same absolute return time", async () => {
  const input = fixture();
  input.shortsProgress.C1.target = 10;
  const workers = Object.fromEntries(TYPE_ORDER.map(type => [type, type === "Mining Pod" ? 4 : 0]));
  input.shortsProgress.C1.active = { remainingHours: 2, workers };
  const result = await solve(input);
  const active = result.shortsPlan.jobs.find(job => job.alreadyRunning);
  assert.deepEqual(active.workers, workers);
  assert.equal(active.finishHours, 2);
  assert.equal(active.endHours, 8);
  let state = createTracker(result, input, now);
  assert.equal(state.missions[active.name].endsAt, now + 2 * hour);
  const request = prepareTrackerUpdate(state, input, now + hour);
  assert.equal(request.input.awayUntil, now + 8 * hour);
  const replanned = await optimizeShorts(request.input, { plannedAt: request.startedAt });
  assert.equal(replanned.shortsPlan.awayHours, 7);
  state = mergeTrackerUpdate(state, replanned, request.input, request.startedAt, now + hour);
  assert.equal(state.missions[active.name].endsAt, now + 2 * hour);
  validateTracker(state);
  const free = trackerFreeWorkers(state);
  assert.ok(trackerActions(state, now + 3 * hour).finished.some(job => job.name === active.name));
  assert.deepEqual(trackerFreeWorkers(state), free, "expiry never silently frees crews");
  state = transitionTracker(state, { type: "complete", name: active.name }, now + 3 * hour);
  assert.match(campaignStartProblem(state, "C1-10", now + 3 * hour), /return/);
  const early = prepareTrackerUpdate(state, { ...input, awayEnabled: false }, now + 3 * hour);
  const earlyPlan = await optimizeShorts(early.input, { plannedAt: early.startedAt });
  assert.equal(earlyPlan.shortsPlan.awayHours, 0, "returning early can remove the launch restriction by replanning");
});

test("away settings validate, survive saving, default off for old saves, and expire without restarting", async () => {
  const input = fixture();
  assert.equal(validateInput({ ...input, awayUntil: NaN }).errors[0].field, "awayUntil");
  assert.equal(validateInput({ ...input, awayUntil: 0 }).errors[0].field, "awayUntil");
  assert.equal(sanitizePersistedInput(input).awayUntil, input.awayUntil);
  assert.equal(sanitizePersistedInput({}).awayEnabled, false);
  assert.equal(awayHoursRemaining(input, now + 9 * hour), 0);
  const expired = await solve({ ...input, awayUntil: now - hour });
  const normal = await solve({ ...input, awayEnabled: false });
  assert.deepEqual(expired.shortsPlan.jobs, normal.shortsPlan.jobs);
  assert.equal(expired.shortsPlan.awayHours, 0);
});
