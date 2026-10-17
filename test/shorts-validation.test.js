import assert from "node:assert/strict";
import test from "node:test";
import { TYPE_ORDER } from "../src/data.js";
import { shortsScheduleErrors } from "../src/shorts-validation.js";

const crew = count => Object.fromEntries(TYPE_ORDER.map((type, index) => [type, index ? 0 : count]));
const workers = Object.fromEntries(TYPE_ORDER.map(type => [type, { power: 1 }]));
const first = { name: "C1-1", chain: 0, work: 4, cap: 2 };
const second = { name: "C1-2", chain: 0, work: 4, cap: 2 };
const chains = [[first, second]];
const plan = { totalHours: 12, jobs: [
  { ...first, workers: crew(1), startHours: 0, finishHours: 4, endHours: 8, alreadyRunning: false },
  { ...second, workers: crew(1), startHours: 8, finishHours: 12, endHours: 12, alreadyRunning: false }
] };
const check = (value, initial = [], farms = {}) => shortsScheduleErrors(chains, initial, crew(2), workers, value, farms, 8);

test("independent schedule replay rejects corrupted crews, timing, order, and totals", () => {
  assert.deepEqual(check(plan), []);
  const changes = [
    value => { value.jobs[0].workers = crew(3); },
    value => { value.jobs[0].workers = crew(0.5); },
    value => { value.jobs[0].finishHours = 3; },
    value => { value.jobs[0].endHours = 4; },
    value => { value.jobs[1].startHours = 4; },
    value => { value.jobs[1].name = first.name; },
    value => { value.jobs[1].alreadyRunning = true; },
    value => { value.totalHours = 11; }
  ];
  for (const change of changes) {
    const value = structuredClone(plan);
    change(value);
    assert.ok(check(value).length, change.toString());
  }
});

test("independent replay checks farm capacity at collection and keeps imported timers fixed", () => {
  assert.deepEqual(check(plan, [], { [first.name]: [{ type: TYPE_ORDER[0], count: 1 }] }), []);
  assert.match(check(plan, [], { [first.name]: [{ type: TYPE_ORDER[0], count: 2 }] }).join(" "), /overallocated/);
  const active = { ...plan.jobs[0], alreadyRunning: true };
  const value = { ...plan, jobs: [active, plan.jobs[1]] };
  assert.deepEqual(check(value, [active]), []);
  assert.match(check(value, [{ ...active, finishHours: 5 }]).join(" "), /changed running/);
});
