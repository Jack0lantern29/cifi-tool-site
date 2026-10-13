import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultInput, validateInput } from "../src/validation.js";
import { optimizeShorts } from "../src/shorts-optimizer.js";
import { progressAtShortsStep } from "../src/shorts-progress.js";

function fixture() {
  const input = createDefaultInput();
  input.ouroUnlocked = input.campaignEnabled = input.shortsEnabled = true;
  input.selectedCampaignFarmMissions = [];
  input.workers["Mining Pod"] = { power: 1000000, count: 1000 };
  return input;
}

test("C2 and C3 wait for stage 8 unlocks while C4 can start immediately", async () => {
  const input = fixture();
  input.shortsProgress.C1 = { completed: 7, target: 9, active: null };
  input.shortsProgress.C2.target = 9;
  input.shortsProgress.C3.target = 1;
  input.shortsProgress.C4.target = 1;
  const { shortsPlan: plan } = await optimizeShorts(input);
  const job = name => plan.jobs.find(item => item.name === name);
  assert.equal(plan.status, "best-found");
  assert.ok(job("C2-1").startHours >= job("C1-8").endHours);
  assert.ok(job("C3-1").startHours >= job("C2-8").endHours);
  assert.equal(job("C4-1").startHours, 0);
  assert.ok(job("C2-1").startHours < job("C1-9").endHours, "sections may overlap once unlocked");
  assert.ok(plan.certificate.lowerBoundHours <= plan.totalHours);
});

test("a fresh C3 target includes both prerequisite sections and resumes with those targets", async () => {
  const input = fixture();
  input.shortsProgress.C3.target = 1;
  const result = await optimizeShorts(input);
  assert.equal(result.shortsProgress.C1.target, 8);
  assert.equal(result.shortsProgress.C2.target, 8);
  assert.equal(result.shortsPlan.jobs.length, 17);
  assert.equal(input.shortsProgress.C1.target, 0, "saved user choices are not mutated");
  const unlock = result.shortsPlan.jobs.find(job => job.name === "C1-8");
  const next = progressAtShortsStep(result.shortsProgress, result.shortsPlan, unlock.endHours);
  assert.equal(next.C1.completed, 8);
  const resumed = await optimizeShorts({ ...input, shortsProgress: next });
  assert.ok(!resumed.shortsPlan.jobs.some(job => job.section === "C1"));
  assert.ok(resumed.shortsPlan.jobs.find(job => job.name === "C3-1").startHours >= resumed.shortsPlan.jobs.find(job => job.name === "C2-8").endHours);
});

test("C4 alone needs no earlier campaign section", async () => {
  const input = fixture();
  input.shortsProgress.C4.target = 1;
  const result = await optimizeShorts(input);
  assert.deepEqual(result.shortsPlan.jobs.map(job => job.name), ["C4-1"]);
  assert.equal(result.shortsPlan.jobs[0].startHours, 0);
});

test("running locked sections are rejected and a running prerequisite releases the next section", async () => {
  const input = fixture();
  input.shortsProgress.C2 = { completed: 0, target: 1, active: { remainingHours: 1, workers: { "Mining Pod": 1 } } };
  assert.ok(validateInput(input).errors.some(error => error.field === "shorts-running-C2"));
  input.shortsProgress.C2.active = null;
  input.shortsProgress.C3 = { completed: 0, target: 1, active: { remainingHours: 1, workers: { "Mining Pod": 1 } } };
  assert.ok(validateInput(input).errors.some(error => error.field === "shorts-running-C3"));
  input.shortsProgress.C3 = { completed: 0, target: 0, active: null };
  input.shortsProgress.C1 = { completed: 7, target: 8, active: { remainingHours: 2, workers: { "Mining Pod": 1 } } };
  const result = await optimizeShorts(input);
  assert.equal(result.shortsPlan.jobs.find(job => job.name === "C1-8").endHours, 2);
  assert.equal(result.shortsPlan.jobs.find(job => job.name === "C2-1").startHours, 2);
});
