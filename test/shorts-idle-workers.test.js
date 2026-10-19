import assert from "node:assert/strict";
import test from "node:test";
import { TYPE_ORDER } from "../src/data.js";
import { fillIdleShortsCrews } from "../src/shorts-search.js";
import { shortsScheduleErrors } from "../src/shorts-validation.js";
import { createSeededRandom } from "../src/random.js";

const crew = (pods = 0, carriers = 0) => Object.fromEntries(TYPE_ORDER.map((type, i) => [type, [pods, carriers, 0, 0][i]]));
const workers = Object.fromEntries(TYPE_ORDER.map(type => [type, { power: 1 }]));
const job = (chain, work, cap, team, startHours, away = 0) => ({
  name: `C${chain + 1}-1`, section: `C${chain + 1}`, chain, work, cap, workers: team, startHours,
  finishHours: startHours + Math.max(2 / 3600, work / Object.values(team).reduce((a, b) => a + b, 0)),
  endHours: Math.max(away, startHours + Math.max(2 / 3600, work / Object.values(team).reduce((a, b) => a + b, 0))),
  alreadyRunning: false
});

function fill(jobs, available, away = 0, farms = {}) {
  const chains = jobs.map(item => [item]);
  const initial = jobs.filter(item => item.alreadyRunning);
  const incumbent = { jobs, totalHours: Math.max(...jobs.map(item => item.endHours)) };
  const before = structuredClone(incumbent);
  const result = fillIdleShortsCrews(chains, initial, available, workers, incumbent, farms, away);
  assert.deepEqual(incumbent, before, "do not mutate the input plan or locked crews");
  assert.deepEqual(shortsScheduleErrors(chains, initial, available, workers, result, farms, away), []);
  assert.ok(result.totalHours <= incumbent.totalHours);
  return result;
}

test("fill spare workers when return time hides any improvement in the final ETA", () => {
  const result = fill([job(0, 8, 10, crew(1), 0, 8)], crew(10), 8);
  assert.deepEqual(result.jobs[0].workers, crew(10));
  assert.equal(result.jobs[0].finishHours, 0.8);
  assert.equal(result.totalHours, 8);
});

test("fill normal Shorts crews even when a locked mission determines the final ETA", () => {
  const locked = { ...job(1, 20, 1, crew(0, 1), 0), alreadyRunning: true };
  const result = fill([job(0, 10, 10, crew(1), 0), locked], crew(10, 1));
  assert.deepEqual(result.jobs[0].workers, crew(10));
  assert.deepEqual(result.jobs[1], locked);
  assert.equal(result.totalHours, 20);
});

test("spares needed by a later launch stay available until that launch", () => {
  const result = fill([job(0, 100, 10, crew(1), 0), job(1, 5, 5, crew(5), 2)], crew(6));
  assert.deepEqual(result.jobs[0].workers, crew(1));
  assert.equal(result.jobs[1].startHours, 2);
});

test("spares can finish a mission before they are needed by a later launch", () => {
  const result = fill([job(0, 10, 6, crew(1), 0), job(1, 5, 5, crew(5), 2)], crew(6));
  assert.deepEqual(result.jobs[0].workers, crew(6));
  assert.ok(result.jobs[0].endHours < result.jobs[1].startHours);
});

test("filling a crew cannot consume personnel reserved for an earlier farm unlock", () => {
  const locked = { ...job(1, 2, 1, crew(0, 1), 0), alreadyRunning: true };
  const farms = { [locked.name]: [{ name: "F2-1", type: TYPE_ORDER[0], count: 5 }] };
  const result = fill([job(0, 100, 10, crew(1), 0), locked], crew(6, 1), 0, farms);
  assert.deepEqual(result.jobs[0].workers, crew(1));
});

test("partially fill a crew when speeding it further would unlock a farm too early", () => {
  const locked = { ...job(1, 3, 1, crew(0, 1), 0), alreadyRunning: true };
  const target = job(0, 10, 10, crew(1), 0);
  const farms = { [target.name]: [{ name: "F1-1", type: TYPE_ORDER[1], count: 1 }] };
  const result = fill([target, locked], crew(10, 1), 0, farms);
  assert.deepEqual(result.jobs[0].workers, crew(3));
  assert.equal(result.jobs[0].finishHours, 10 / 3);
});

test("filling respects mission capacity and the two-second duration floor", () => {
  const capped = fill([job(0, 10, 2, crew(1), 0)], crew(10));
  assert.deepEqual(capped.jobs[0].workers, crew(2));
  const fast = fill([job(0, 0.001, 10, crew(1), 0)], crew(10));
  assert.deepEqual(fast.jobs[0].workers, crew(2));
  assert.equal(fast.totalHours, 2 / 3600);
});

// Independent occupancy oracle: brute-force every possible crew addition for
// these small cases, rather than using the allocator's candidate selection.
function peakUsage(jobs, farms) {
  const peak = crew();
  for (const time of jobs.flatMap(item => [item.startHours, item.endHours])) {
    const used = crew();
    for (const item of jobs) {
      if (item.startHours <= time && time < item.endHours) {
        for (const type of TYPE_ORDER) used[type] += item.workers[type];
      }
      if (item.endHours <= time) for (const row of farms[item.name] || []) used[row.type] += row.count;
    }
    for (const type of TYPE_ORDER) peak[type] = Math.max(peak[type], used[type]);
  }
  return peak;
}

test("500 generated schedules leave no feasible useful addition of any one worker type", () => {
  const random = createSeededRandom(20261019);
  const integer = max => Math.floor(random() * max);
  for (let example = 0; example < 500; example++) {
    const away = example % 2 ? 8 : 0;
    const powers = Object.fromEntries(TYPE_ORDER.map((type, index) => [type, { power: index === 3 ? 0 : [0.5, 1, 3, 11][integer(4)] }]));
    const jobs = Array.from({ length: 2 + integer(3) }, (_, chain) => {
      const workers = crew();
      workers[TYPE_ORDER[integer(3)]] = 1 + integer(3);
      const count = Object.values(workers).reduce((a, b) => a + b, 0);
      const power = TYPE_ORDER.reduce((value, type) => value + workers[type] * powers[type].power, 0);
      const startHours = integer(2) ? 0 : away + integer(10);
      const work = example % 17 === 0 ? 0.0001 : 1 + integer(40);
      const finishHours = startHours + Math.max(2 / 3600, work / power);
      return { name: `C${chain + 1}-1`, section: `C${chain + 1}`, chain, work, cap: count + integer(5), workers,
        startHours, finishHours, endHours: Math.max(away, finishHours), alreadyRunning: startHours === 0 && integer(4) === 0 };
    });
    const farms = Object.fromEntries(jobs.filter(() => integer(3) === 0).map(item => [item.name,
      [{ name: `F${item.chain + 1}-1`, type: TYPE_ORDER[integer(3)], count: 1 + integer(2) }]]));
    const available = peakUsage(jobs, farms);
    for (const type of TYPE_ORDER) available[type] += integer(3);
    const chains = jobs.map(item => [item]);
    const initial = jobs.filter(item => item.alreadyRunning);
    const incumbent = { jobs, totalHours: Math.max(...jobs.map(item => item.endHours)) };
    const before = structuredClone(incumbent);
    const result = fillIdleShortsCrews(chains, initial, available, powers, incumbent, farms, away);
    const context = `generated case ${example}, seed 20261019`;
    assert.deepEqual(incumbent, before, context);
    assert.deepEqual(shortsScheduleErrors(chains, initial, available, powers, result, farms, away), [], context);
    assert.ok(result.totalHours <= incumbent.totalHours, context);
    const demand = peakUsage(result.jobs, farms);
    assert.ok(TYPE_ORDER.every(type => demand[type] <= available[type]), context);
    for (const item of result.jobs.filter(item => !item.alreadyRunning)) {
      const used = Object.values(item.workers).reduce((a, b) => a + b, 0);
      const power = TYPE_ORDER.reduce((value, type) => value + item.workers[type] * powers[type].power, 0);
      for (const type of TYPE_ORDER.filter(type => powers[type].power > 0)) {
        for (let extra = 1; extra <= Math.min(item.cap - used, available[type] - item.workers[type]); extra++) {
          const finishHours = item.startHours + Math.max(2 / 3600, item.work / (power + extra * powers[type].power));
          if (finishHours >= item.finishHours) continue;
          const updated = { ...item, workers: { ...item.workers, [type]: item.workers[type] + extra }, finishHours, endHours: Math.max(away, finishHours) };
          const demand = peakUsage(result.jobs.map(other => other === item ? updated : other), farms);
          assert.ok(TYPE_ORDER.some(type => demand[type] > available[type]), `${context}: ${item.name} can still use ${extra} ${type}`);
        }
      }
    }
  }
});
