import assert from "node:assert/strict";
import test from "node:test";
import { TYPE_ORDER } from "../src/data.js";
import { createDefaultInput } from "../src/validation.js";
import { optimizeShorts } from "../src/shorts-optimizer.js";
import { optimize } from "../src/optimizer.js";
import { reserveTrackedFarms, mergeTrackedFarms } from "../src/tracked-farms.js";
import { createTracker, transitionTracker, trackerActions, trackerFreeWorkers, campaignStartProblem, prepareTrackerUpdate, mergeTrackerUpdate, pendingNotifications, saveTracker, loadTracker, validateTracker, TRACKER_STORAGE_KEY } from "../src/shorts-tracker.js";

const now = Date.parse("2026-10-03T15:30:00Z");
const crew = count => Object.fromEntries(TYPE_ORDER.map((type, i) => [type, i === 0 ? count : 0]));
function inputFixture() {
  const input = createDefaultInput();
  input.ouroUnlocked = input.campaignEnabled = input.shortsEnabled = true;
  input.selectedCampaignFarmMissions = [];
  input.workers = Object.fromEntries(TYPE_ORDER.map((type, i) => [type, { count: i === 0 ? 1000 : 0, power: 10000 }]));
  input.shortsProgress.C1.target = 2;
  input.shortsProgress.C4.target = 1;
  return input;
}
async function fixture(input = inputFixture()) {
  const result = await optimizeShorts(input);
  const state = createTracker(result, input, now);
  return { input, result, state };
}
const action = (state, type, name, time = now, extra = {}) => transitionTracker(state, { type, name, ...extra }, time);
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test("tracking starts no queued campaigns; independent starts use actual times and expiry never releases crews", async () => {
  let { state } = await fixture();
  assert.equal(trackerActions(state, now).running.length, 0);
  assert.equal(trackerActions(state, now).ready.length, 2);
  assert.match(campaignStartProblem(state, "C1-2", now), /previous/);
  state = action(state, "start", "C1-1", now + 3000);
  state = action(state, "start", "C4-1", now + 3000);
  assert.equal(state.missions["C1-1"].startedAt, now + 3000);
  assert.equal(state.missions["C1-1"].imported, false);
  const free = trackerFreeWorkers(state);
  assert.throws(() => action(state, "complete", "C1-1", now + 3000), /timer/);
  const end = Math.max(...Object.values(state.missions).filter(job => job.status === "running").map(job => job.endsAt));
  assert.equal(trackerActions(state, end).finished.length, 2);
  assert.deepEqual(trackerFreeWorkers(state), free);
  assert.equal(state.completed.C1, 0);
  assert.match(campaignStartProblem(state, "C1-2", end), /Confirm/);
  state = action(state, "complete", "C1-1", end);
  assert.deepEqual(trackerFreeWorkers(state), Object.fromEntries(TYPE_ORDER.map(type => [type, free[type] + state.missions["C1-1"].workers[type]])));
  state = action(state, "complete", "C4-1", end);
  assert.equal(campaignStartProblem(state, "C1-2", end), null);
  validateTracker(state);
});

test("imported running campaigns have no invented start or percentage; corrections retain locked crews", async () => {
  const input = inputFixture();
  input.shortsProgress.C1.active = { remainingHours: 1, workers: crew(1) };
  let { state } = await fixture(input);
  const job = state.missions["C1-1"];
  assert.equal(job.imported, true);
  assert.equal(job.startedAt, null);
  assert.equal(job.endsAt, now + 3600000);
  for (const remainingHours of [-1, NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => action(state, "correct", job.name, now, { remainingHours }), /valid/);
  state = action(state, "correct", job.name, now + 5000, { remainingHours: 0 });
  assert.deepEqual(state.missions[job.name].workers, job.workers);
  assert.equal(state.missions[job.name].endsAt, now + 5000);
  assert.equal(state.missions[job.name].status, "running");
  assert.equal(state.needsUpdate, true);
  state = action(state, "complete", job.name, now + 5000);
  assert.equal(state.completed.C1, 1);
});

test("future plan steps stay queued even when their crew is individually free", async () => {
  let { state } = await fixture();
  const first = state.missions["C1-1"];
  const later = state.missions["C4-1"];
  later.plannedStartHours = first.plannedEndHours;
  later.plannedEndHours = later.plannedStartHours + later.durationMs / 3600000;
  assert.match(campaignStartProblem(state, later.name, now), /Queued after C1-1/);
  assert.ok(!trackerActions(state, now).ready.some(job => job.name === later.name));
  assert.throws(() => action(state, "start", later.name), /Queued after/);
  // Waiting past the estimate cannot substitute for starting and finishing.
  assert.match(campaignStartProblem(state, later.name, now + 86400000), /Queued after/);
  state = action(state, "start", first.name);
  const end = state.missions[first.name].endsAt;
  state = action(state, "complete", first.name, end);
  assert.equal(campaignStartProblem(state, later.name, end), null);
});

test("displayed concurrent starts share one worker pool and can all be confirmed", async () => {
  let { state } = await fixture();
  state.missions["C1-1"].workers = crew(600);
  state.missions["C4-1"].workers = crew(600);
  state.missions["C4-1"].plannedStartHours = 0;
  const ready = trackerActions(state, now).ready;
  assert.equal(ready.length, 1, "two individually feasible launches cannot double book 1,000 workers");
  for (const job of ready) state = action(state, "start", job.name);
  assert.ok(Object.values(trackerFreeWorkers(state)).every(count => count >= 0));
});

test("cross-section unlocks require confirmed C1-8 and C2-8; C4 is independent", async () => {
  const input = inputFixture();
  input.shortsProgress.C1 = { completed: 7, target: 8, active: null };
  input.shortsProgress.C2 = { completed: 0, target: 1, active: null };
  let { state } = await fixture(input);
  assert.match(campaignStartProblem(state, "C2-1", now), /C1-8/);
  assert.equal(campaignStartProblem(state, "C4-1", now), null);
  state = action(state, "start", "C1-8");
  state = action(state, "start", "C4-1");
  const end = state.missions["C1-8"].endsAt;
  assert.match(campaignStartProblem(state, "C2-1", end), /Confirm/);
  state = action(state, "complete", "C1-8", end);
  assert.equal(campaignStartProblem(state, "C2-1", end), null);
  input.shortsProgress.C1.completed = 8;
  input.shortsProgress.C2 = { completed: 7, target: 8, active: null };
  input.shortsProgress.C3.target = 1;
  ({ state } = await fixture(input));
  assert.match(campaignStartProblem(state, "C3-1", now), /C2-8/);
});

test("newly unlocked farms require confirmation and retain crews before subsequent campaign starts", async () => {
  const input = inputFixture();
  input.shortsProgress.C4.target = 0;
  input.selectedCampaignFarmMissions = ["F1-1"];
  let { state } = await fixture(input);
  assert.equal(state.farms["F1-1"].status, "pending");
  assert.throws(() => action(state, "farm", "F1-1"), /not ready/);
  state = action(state, "start", "C1-1");
  const end = state.missions["C1-1"].endsAt;
  state = action(state, "complete", "C1-1", end);
  assert.equal(trackerActions(state, end).farms.length, 1);
  assert.match(campaignStartProblem(state, "C1-2", end), /farm assignments/);
  const free = trackerFreeWorkers(state);
  state = action(state, "farm", "F1-1", end);
  assert.equal(state.farms["F1-1"].status, "reserved");
  assert.equal(trackerFreeWorkers(state)[TYPE_ORDER[0]], free[TYPE_ORDER[0]] - state.farms["F1-1"].workers[TYPE_ORDER[0]]);
  assert.equal(campaignStartProblem(state, "C1-2", end), null);
  validateTracker(state);
});

test("availability and the farm unlock horizon prevent unsafe launches", async () => {
  let { state } = await fixture();
  state.missions["C1-1"].workers = crew(100);
  state.missions["C1-1"].durationMs = 1000;
  state.missions["C4-1"].workers = crew(950);
  state = action(state, "start", "C1-1");
  assert.match(campaignStartProblem(state, "C4-1", now), /required workers/);
  state.missions["C4-1"].workers = crew(850);
  state.missions["C4-1"].durationMs = 10000;
  state.farms["F1-1"] = { name: "F1-1", workers: crew(200), status: "pending", unlockCampaign: "C1-1" };
  assert.match(campaignStartProblem(state, "C4-1", now), /upcoming farm/);
});

test("reopen restores absolute expired timers without completing them; corrupt saves leave settings intact", async () => {
  let { state } = await fixture();
  state = action(state, "start", "C1-1");
  const storage = memoryStorage();
  storage.setItem("ordinary-settings", "keep");
  saveTracker(state, storage);
  const restored = loadTracker(storage);
  assert.equal(restored.warning, "");
  assert.deepEqual(restored.state, state);
  assert.equal(trackerActions(restored.state, now + 86400000).finished.length, 1);
  assert.equal(restored.state.completed.C1, 0);
  for (const corrupt of ["{", JSON.stringify({ schemaVersion: 900 }), JSON.stringify({ ...state, result: { ...state.result, assignments: [{ name: "<script>", type: TYPE_ORDER[0], count: 1 }] } }), JSON.stringify({ ...state, missions: {} })]) {
    storage.setItem(TRACKER_STORAGE_KEY, corrupt);
    assert.equal(loadTracker(storage).state, null);
    assert.equal(storage.getItem(TRACKER_STORAGE_KEY), null);
    assert.equal(storage.getItem("ordinary-settings"), "keep");
  }
});

test("manual updates use latest settings and preserve actual active timers, crews and completed history", async () => {
  let { input, state } = await fixture();
  state = action(state, "start", "C1-1");
  state = action(state, "correct", "C1-1", now, { remainingHours: 1 });
  input.workers[TYPE_ORDER[0]].count += 100;
  input.modifiers.engineeringBadge = true;
  const request = prepareTrackerUpdate(state, input, now + 60000);
  assert.equal(request.input.shortsProgress.C1.active.remainingHours, 59 / 60);
  const result = await optimizeShorts(request.input, { reservedFarms: request.reservedFarms });
  const updated = mergeTrackerUpdate(state, result, request.input, request.startedAt, now + 120000);
  assert.deepEqual(updated.missions["C1-1"], state.missions["C1-1"]);
  assert.equal(updated.input.workers[TYPE_ORDER[0]].count, 1100);
  assert.equal(updated.input.modifiers.engineeringBadge, true);
  validateTracker(updated);
  const expired = mergeTrackerUpdate(state, result, request.input, request.startedAt, now + 3600000);
  assert.equal(expired.missions["C1-1"].status, "running");
  assert.equal(expired.needsUpdate, true);
  assert.throws(() => prepareTrackerUpdate(state, input, now + 3600000), /Confirm/);
  assert.throws(() => mergeTrackerUpdate(state, { ...result, solutionStatus: "cancelled-best" }, request.input, now), /cancelled/);
  assert.throws(() => mergeTrackerUpdate(state, { ...result, shortsPlan: { ...result.shortsPlan, status: "blocked" } }, request.input, now), /feasible/);
  assert.equal(state.missions["C1-1"].endsAt, now + 3600000);
});

test("fixed farm allocations survive recalculation and preserve their actual hourly rewards", async () => {
  const input = inputFixture();
  input.shortsProgress.C1.completed = 1;
  input.selectedCampaignFarmMissions = ["F1-1"];
  const { state } = await fixture(input);
  const request = prepareTrackerUpdate(state, input, now);
  assert.ok(request.reservedFarms.length);
  const result = await optimizeShorts(request.input, { reservedFarms: request.reservedFarms });
  assert.deepEqual(result.assignments.filter(row => row.name.startsWith("F")), request.reservedFarms);
  const updated = mergeTrackerUpdate(state, result, input, now);
  assert.deepEqual(updated.farms, state.farms);
  validateTracker(updated);
  const farmOnly = { ...input, campaignEnabled: false, shortsEnabled: false, selectedFarmMissions: ["F1-1"] };
  const farmResult = optimize(farmOnly);
  const empty = { ...farmResult, assignments: [], selectedFarmNames: [], totals: Object.fromEntries(Object.keys(farmResult.totals).map(key => [key, 0])) };
  const merged = mergeTrackedFarms(empty, farmOnly, farmResult.assignments);
  for (const key of Object.keys(farmResult.totals)) assert.ok(Math.abs(merged.totals[key] - farmResult.totals[key]) < 1e-6, key);
  assert.throws(() => reserveTrackedFarms({ ...input, workers: Object.fromEntries(TYPE_ORDER.map(type => [type, { count: 0, power: 1 }])) }, request.reservedFarms), /Total/);
});

test("notifications are opt-in, deduplicated across refreshes, and never release workers", async () => {
  let { state } = await fixture();
  state = action(state, "start", "C1-1");
  const end = state.missions["C1-1"].endsAt;
  assert.deepEqual(pendingNotifications(state, end), []);
  state = transitionTracker(state, { type: "notifications", enabled: true }, now);
  assert.deepEqual(pendingNotifications(state, end).map(job => job.name), ["C1-1"]);
  const free = trackerFreeWorkers(state);
  state.missions["C1-1"].notifiedFor = end;
  const storage = memoryStorage();
  saveTracker(state, storage);
  state = loadTracker(storage).state;
  assert.deepEqual(pendingNotifications(state, end + 60000), []);
  assert.deepEqual(trackerFreeWorkers(state), free);
  assert.equal(state.completed.C1, 0);
  state = action(state, "correct", "C1-1", end, { remainingHours: 1 });
  assert.equal(pendingNotifications(state, end).length, 0);
  assert.equal(pendingNotifications(state, end + 3600000).length, 1);
});

test("saved campaign crews respect enlarged Relic 11 capacities", async () => {
  const input = inputFixture();
  input.relic11Level = 3;
  input.shortsProgress.C1.active = { remainingHours: 1, workers: crew(12) };
  const { state } = await fixture(input);
  assert.equal(state.missions["C1-1"].cap, 13);
  const storage = memoryStorage();
  saveTracker(state, storage);
  assert.deepEqual(loadTracker(storage).state, state);
});
