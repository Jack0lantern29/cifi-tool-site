import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_DATA, TYPE_ORDER } from "../src/data.js";
import { calculateGlobalSpeedMultiplier, createDefaultInput } from "../src/validation.js";
import { createSeededRandom } from "../src/random.js";
import { advanceAwayStarts as jointAwayStarts, exactShorts, refineShorts, balancedShorts, polishShorts, shortsLowerBound } from "../src/shorts-search.js";
import { loadOptimizationSolver } from "../src/crazy-optimizer.js";
import { solveAwayAllocation } from "../src/away-allocation.js";

const highs = await loadOptimizationSolver();
const solveCrews = (...args) => solveAwayAllocation(highs, ...args);
const advanceAwayStarts = (chains, initial, available, powers, incumbent, farms = {}, hours = 0) => jointAwayStarts(chains, initial, available, powers, incumbent, farms, hours, solveCrews);

const crew = (pods = 0, carriers = 0) => Object.fromEntries(TYPE_ORDER.map((type, index) => [type, [pods, carriers, 0, 0][index]]));
const workers = (a, b) => Object.fromEntries(TYPE_ORDER.map((type, index) => [type, { power: [a, b, 0, 0][index] }]));
const task = (chain, work, cap = 1) => ({ name: `C${chain + 1}-1`, section: `C${chain + 1}`, chain, work, cap });

test("away repair launches C2-9 with the reported spare personnel instead of waiting for a larger crew", () => {
  const input = createDefaultInput();
  input.ouroUnlocked = true;
  Object.assign(input.modifiers, { engineeringBadge: true, swarmLevel: 40, productivityLevel: 11, research58: 6, research70: 6, research80: 2, relic3: 40, ts07Enabled: true });
  const powers = Object.fromEntries(TYPE_ORDER.map((type, i) => [type, { power: [6.5, 13, 22, 41][i] }]));
  const spare = Object.fromEntries(TYPE_ORDER.map((type, i) => [type, [716, 129, 2, 415][i]]));
  const mission = MISSION_DATA.find(row => row.name === "C2-9");
  const target = { name: mission.name, section: "C2", chain: 1, cap: mission.cap * 2.5, work: mission.minutes / 60 / calculateGlobalSpeedMultiplier(input) };
  const fullPower = TYPE_ORDER.reduce((value, type) => value + spare[type] * powers[type].power, 0);
  assert.equal(Math.floor(target.work / fullPower * 3600), 4 * 3600 + 8 * 60 + 52);
  const locked = { ...task(0, 1, 1000), name: "C1-9", workers: crew(0, 936), startHours: 0, finishHours: 2 + 22 / 60 + 51 / 3600, endHours: 10, alreadyRunning: true };
  const available = Object.fromEntries(TYPE_ORDER.map(type => [type, spare[type] + locked.workers[type]]));
  const largerCrew = { ...spare, "Fireteam Carrier": 1065 };
  const power = TYPE_ORDER.reduce((value, type) => value + largerCrew[type] * powers[type].power, 0);
  const queued = { ...target, workers: largerCrew, startHours: 10, finishHours: 10 + target.work / power, endHours: 10 + target.work / power, alreadyRunning: false };
  const incumbent = { jobs: [locked, queued], totalHours: queued.endHours };
  const result = advanceAwayStarts([[locked], [target]], [locked], available, powers, incumbent, {}, 10);
  const launched = result.jobs.find(job => job.name === "C2-9");
  assert.equal(launched.startHours, 0);
  assert.ok(launched.finishHours <= 10);
  assert.equal(launched.endHours, 10);
  assert.ok(TYPE_ORDER.every(type => launched.workers[type] <= spare[type]));
  assert.deepEqual(result.jobs.find(job => job.alreadyRunning), locked);
  assert.ok(result.totalHours < incumbent.totalHours);
});

test("away repair honours farm unlocks, caps, prerequisites, and insufficient spare power", () => {
  const locked = { ...task(0, 1), workers: crew(0, 1), startHours: 0, finishHours: 12, endHours: 12, alreadyRunning: true };
  const target = task(1, 4);
  const queued = { ...target, workers: crew(1), startHours: 12, finishHours: 16, endHours: 16 };
  const incumbent = { jobs: [locked, queued], totalHours: 16 };
  const run = (job = target, pool = crew(1, 1), reservations = {}, away = 8) => advanceAwayStarts([[locked], [job]], [locked], pool, workers(1, 1), { ...incumbent, jobs: [locked, { ...queued, ...job }] }, reservations, away);
  assert.equal(run().jobs[1].startHours, 0);
  assert.equal(run(target, crew(1, 1), { [target.name]: [{ name: "F2-1", type: TYPE_ORDER[1], count: 1 }] }).jobs[1].startHours, 12, "an earlier unlock cannot take workers from a running mission");
  assert.equal(run({ ...target, prerequisite: locked.name }).jobs[1].startHours, 12);
  assert.equal(run({ ...target, work: 20 }, crew(100, 1)).jobs[1].startHours, 12, "spare workers cannot bypass the mission cap");
  assert.equal(run(target, crew(0, 1)).jobs[1].startHours, 12);
  assert.equal(run(target, crew(1, 1), {}, 0).jobs[1].startHours, 12);
});

test("away repair uses idle capacity even when another section fixes the final ETA", () => {
  const locked = { ...task(0, 1), workers: crew(0, 1), startHours: 0, finishHours: 20, endHours: 20, alreadyRunning: true };
  const targets = [task(1, 4), task(2, 4)];
  const jobs = targets.map(job => ({ ...job, workers: crew(1), startHours: 8, finishHours: 12, endHours: 12 }));
  const result = advanceAwayStarts([[locked], [targets[0]], [targets[1]]], [locked], crew(2, 1), workers(1, 1), { jobs: [locked, ...jobs], totalHours: 20 }, {}, 8);
  assert.equal(result.totalHours, 20);
  assert.ok(result.jobs.filter(job => !job.alreadyRunning).every(job => job.startHours === 0 && job.endHours === 8));
  assert.deepEqual(result.jobs.find(job => job.alreadyRunning), locked);
});

test("joint away check exchanges worker types to fit a tight-cap mission before return", () => {
  const first = task(0, 8, 10), second = task(1, 80, 1);
  const jobs = [
    { ...first, workers: crew(0, 1), startHours: 0, finishHours: 0.8, endHours: 8 },
    { ...second, workers: crew(0, 1), startHours: 8, finishHours: 16, endHours: 16 }
  ];
  const result = advanceAwayStarts([[first], [second]], [], crew(10, 1), workers(1, 10), { jobs, totalHours: 16 }, {}, 8);
  assert.equal(result.totalHours, 8);
  assert.ok(result.jobs.every(job => job.startHours === 0));
  assert.equal(result.jobs[0].workers[TYPE_ORDER[1]], 0, "release the strong worker from the roomy mission");
  assert.equal(result.jobs[1].workers[TYPE_ORDER[1]], 1);
});

test("joint away check reduces an early crew even when no personnel are currently spare", () => {
  const first = task(0, 8, 2), second = task(1, 8, 1);
  const jobs = [
    { ...first, workers: crew(2), startHours: 0, finishHours: 4, endHours: 8 },
    { ...second, workers: crew(1), startHours: 8, finishHours: 16, endHours: 16 }
  ];
  const result = advanceAwayStarts([[first], [second]], [], crew(2), workers(1, 0), { jobs, totalHours: 16 }, {}, 8);
  assert.equal(result.totalHours, 8);
  assert.ok(result.jobs.every(job => job.startHours === 0 && job.workers[TYPE_ORDER[0]] === 1));
});

test("joint integer feasibility agrees with exhaustive independent crew enumeration", () => {
  let cases = 0;
  for (const slow of [1, 2]) for (const fast of [3, 5]) for (const pods of [0, 1, 3]) for (const carriers of [0, 1, 2]) for (const cap of [1, 3]) for (const work of [2, 5, 11]) {
    const jobs = [task(0, work, cap), task(1, 7, 3)];
    let feasible = false;
    for (let a = 0; a <= pods; a++) for (let b = 0; b <= carriers; b++) for (let c = 0; c <= pods - a; c++) for (let d = 0; d <= carriers - b; d++) {
      if (a + b <= cap && c + d <= 3 && a * slow + b * fast >= work && c * slow + d * fast >= 7) feasible = true;
    }
    const result = solveCrews(jobs, crew(pods, carriers), workers(slow, fast), 1);
    assert.equal(Boolean(result), feasible, JSON.stringify({ slow, fast, pods, carriers, cap, work }));
    cases++;
  }
  assert.equal(cases, 216);
});

test("exhaustive search certifies an optimum above the relaxed work bound", () => {
  const chains = [[task(0, 3)], [task(1, 3)]];
  const available = crew(1, 1);
  const powers = workers(3, 2);
  const bound = shortsLowerBound(chains, available, powers);
  assert.ok(Math.abs(bound - 1.2) < 1e-9);
  const result = exactShorts(chains, [], available, powers, { jobs: [], totalHours: 2 });
  assert.equal(result.exhausted, true);
  assert.equal(result.totalHours, 1.5);
  assert.equal(result.jobs.length, 2);
  assert.equal(result.jobs[0].startHours, 0);
  assert.equal(result.jobs[1].startHours, 0);
});

test("exact search matches an independent closed-form two-job oracle across tiny crews", () => {
  for (const a of [1, 2, 4]) for (const b of [1, 3]) for (const x of [1, 3, 7]) for (const y of [2, 5]) {
    const powers = workers(a, b);
    const available = crew(1, 1);
    const chains = [[task(0, x)], [task(1, y)]];
    // With cap=1, either both workers run in parallel, or the faster worker
    // completes both tasks serially. These exhaust the possible assignments.
    const optimum = Math.min(Math.max(x / a, y / b), Math.max(x / b, y / a), (x + y) / Math.max(a, b));
    const result = exactShorts(chains, [], available, powers, { jobs: [], totalHours: 1e6 });
    assert.equal(result.exhausted, true);
    assert.ok(Math.abs(result.totalHours - optimum) < 1e-9);
    assert.ok(shortsLowerBound(chains, available, powers) <= optimum + 1e-9);
  }
});

test("exact search considers waiting for locked workers and never modifies their timers", () => {
  const chains = [[task(0, 3)], [task(1, 3)]];
  const active = { ...chains[1][0], workers: crew(1), startHours: 0, endHours: 1, alreadyRunning: true };
  const result = exactShorts(chains, [active], crew(1, 1), workers(3, 0.1), { jobs: [], totalHours: 30 });
  assert.equal(result.exhausted, true);
  assert.equal(result.totalHours, 2);
  assert.equal(result.jobs[0], active);
  assert.equal(result.jobs[1].startHours, 1);
});

test("away search matches a two-mission oracle including delayed collection", () => {
  for (const away of [2, 8]) for (const a of [1, 3]) for (const b of [1, 2]) for (const x of [2, 7]) for (const y of [3, 9]) {
    const fast = Math.max(a, b);
    const optimum = Math.min(
      Math.max(away, x / a, y / b), Math.max(away, x / b, y / a),
      Math.max(away, x / fast) + y / fast, Math.max(away, y / fast) + x / fast
    );
    const result = exactShorts([[task(0, x)], [task(1, y)]], [], crew(1, 1), workers(a, b), { jobs: [], totalHours: 1e6 }, 100000, {}, away);
    assert.equal(result.exhausted, true);
    assert.ok(Math.abs(result.totalHours - optimum) < 1e-9);
    assert.ok(result.jobs.every(job => job.startHours === 0 || job.startHours >= away));
    assert.ok(result.jobs.every(job => job.finishHours <= job.endHours));
  }
});

test("a truncated search never claims that it exhausted all schedules", () => {
  const result = exactShorts([[task(0, 3)], [task(1, 3)]], [], crew(1, 1), workers(3, 2), { jobs: [], totalHours: 2 }, 0);
  assert.equal(result.exhausted, false);
  assert.equal(result.totalHours, 2);
});

test("exact search and crew refinement honour dependencies between sections", () => {
  const first = { ...task(0, 3), name: "C1-8" };
  const second = { ...task(1, 3), prerequisite: "C1-8" };
  const chains = [[first], [second]];
  const available = crew(1, 1);
  const powers = workers(3, 2);
  const incumbent = { totalHours: 3, jobs: [
    { ...first, workers: crew(0, 1), startHours: 0, endHours: 1.5 },
    { ...second, workers: crew(0, 1), startHours: 1.5, endHours: 3 }
  ] };
  const exact = exactShorts(chains, [], available, powers, incumbent);
  assert.equal(exact.totalHours, 2);
  assert.equal(exact.exhausted, true);
  assert.equal(exact.jobs[1].startHours, 1);
  const refined = refineShorts(chains, [], available, powers, incumbent, createSeededRandom(3));
  assert.ok(refined.jobs.find(job => job.name === "C2-1").startHours >= refined.jobs.find(job => job.name === "C1-8").endHours);
});

test("farm commitments are enforced without claiming an event-only search is exhaustive", () => {
  const chains = [[task(0, 1)], [task(1, 3)]];
  const reservations = { "C1-1": [{ name: "F1-1", type: "Mining Pod", count: 2 }] };
  const result = exactShorts(chains, [], crew(2), workers(1, 0), { jobs: [], totalHours: 5 }, 100000, reservations);
  assert.equal(result.totalHours, 4);
  assert.equal(result.jobs.find(job => job.name === "C1-1").startHours, 3);
  // Delaying C1-1 until hour 2 would allow both to finish at hour 3.
  // That start is between completion events and is not enumerated here.
  assert.equal(result.exhausted, false);
});

test("refinement balances actual crews and minimises the final finish, not the first", () => {
  const chains = [[task(0, 100, 20)], [task(1, 100, 20)]];
  const initial = { totalHours: 20, jobs: chains.map((chain, index) => ({ ...chain[0], startHours: 0, endHours: index ? 20 : 100 / 15, workers: crew(index ? 5 : 15), alreadyRunning: false })) };
  const refined = refineShorts(chains, [], crew(20), workers(1, 0), initial, createSeededRandom(1));
  assert.equal(refined.totalHours, 10);
  assert.ok(refined.jobs.every(job => job.workers["Mining Pod"] === 10));
});

test("the lower bound includes cross-section prerequisites and shared slot limits", () => {
  const first = { ...task(0, 3), name: "C1-8" };
  const second = { ...task(1, 3), prerequisite: first.name };
  assert.ok(Math.abs(shortsLowerBound([[first], [second]], crew(1, 1), workers(3, 2)) - 2) < 1e-9);
  // Many spare slow workers cannot bypass two concurrent single-worker caps.
  const available = crew(1, 100);
  const powers = workers(3, 2);
  assert.ok(Math.abs(shortsLowerBound([[task(0, 30)], [task(1, 30)]], available, powers) - 12) < 1e-9);
});

test("future-farm bounds count only unavoidable commitments, allowing delayed unlocks", () => {
  const first = task(0, 10, 10);
  const second = { ...task(0, 90, 10), name: "C1-2" };
  const farms = { [first.name]: [{ name: "F1-1", type: TYPE_ORDER[0], count: 2 }] };
  // Ten workers complete the first job in one hour; eight then need 11.25h.
  const bound = shortsLowerBound([[first, second]], crew(10), workers(1, 0), [], 0, [0], farms);
  assert.ok(Math.abs(bound - 12.25) < 1e-9);
  // With no descendants, an unlock may wait until the end, holding no power.
  const delayed = shortsLowerBound([[task(0, 1)], [task(1, 3)]], crew(2), workers(1, 0), [], 0, [0, 0], farms);
  assert.ok(Math.abs(delayed - 3) < 1e-9);
});

test("automatic balancing and systematic polishing find the known balanced optimum", () => {
  const chains = [[task(0, 100, 20)], [task(1, 100, 20)]];
  const initial = { totalHours: 20, jobs: chains.map((chain, index) => ({ ...chain[0], startHours: 0, endHours: index ? 20 : 100 / 15, workers: crew(index ? 5 : 15), alreadyRunning: false })) };
  const balanced = balancedShorts(chains, [], crew(20), workers(1, 0), initial);
  const polished = polishShorts(chains, [], crew(20), workers(1, 0), initial);
  assert.equal(balanced.totalHours, 10);
  assert.equal(polished.totalHours, 10);
  assert.ok(polished.jobs.every(job => job.workers[TYPE_ORDER[0]] === 10));
});

test("automatic search retains locked timers and never replaces a better incumbent", () => {
  const chains = [[task(0, 30, 4)], [task(1, 30, 4)]];
  const active = { ...chains[0][0], workers: crew(2), startHours: 0, endHours: 8, alreadyRunning: true };
  const initial = { totalHours: 10, jobs: [active, { ...chains[1][0], workers: crew(0, 2), startHours: 0, endHours: 10 }] };
  for (const result of [balancedShorts(chains, [active], crew(2, 2), workers(3, 1.5), initial), polishShorts(chains, [active], crew(2, 2), workers(3, 1.5), initial)]) {
    assert.ok(result.totalHours <= initial.totalHours);
    assert.deepEqual(result.jobs.find(job => job.name === active.name), active);
    for (const job of result.jobs) if (job.name !== active.name && job.startHours < 8) assert.equal(job.workers[TYPE_ORDER[0]], 0);
  }
});
