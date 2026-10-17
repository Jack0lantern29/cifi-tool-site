import assert from "node:assert/strict";
import test from "node:test";
import { TYPE_ORDER } from "../src/data.js";
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
