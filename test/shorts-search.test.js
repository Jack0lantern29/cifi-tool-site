import assert from "node:assert/strict";
import test from "node:test";
import { TYPE_ORDER } from "../src/data.js";
import { createSeededRandom } from "../src/random.js";
import { exactShorts, refineShorts, balancedShorts, polishShorts, shortsLowerBound } from "../src/shorts-search.js";

const crew = (pods = 0, carriers = 0) => Object.fromEntries(TYPE_ORDER.map((type, index) => [type, [pods, carriers, 0, 0][index]]));
const workers = (a, b) => Object.fromEntries(TYPE_ORDER.map((type, index) => [type, { power: [a, b, 0, 0][index] }]));
const task = (chain, work, cap = 1) => ({ name: `C${chain + 1}-1`, section: `C${chain + 1}`, chain, work, cap });

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
