import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultInput } from "../src/validation.js";
import { optimizeShorts } from "../src/shorts-optimizer.js";

// User-provided settings for the reported ~37-hour route (13 October 2026).
// A positive fragment yield is normalised by Overkill and does not alter its allocation.
export function screenshotInput() {
  const input = createDefaultInput();
  Object.assign(input, { ouroUnlocked: true, campaignEnabled: true, shortsEnabled: true, searchEffort: "crazy", mode: "Fragments", fragmentsPerCompletion: 1, relic11Level: 3 });
  [[6.5, 12074], [13, 6619], [22, 3177], [41, 2071]].forEach(([power, count], index) => { input.workers[Object.keys(input.workers)[index]] = { power, count }; });
  Object.assign(input.modifiers, { engineeringBadge: true, swarmLevel: 40, productivityLevel: 12, research58: 6, research70: 6, research80: 2, relic3: 40, ts07Enabled: true });
  input.selectedFarmMissions = input.selectedCampaignFarmMissions = ["F1-1", "F1-2", "F1-3", "F1-4", "F2-1", "F2-2", "F3-1", "F4-1"];
  [[10, 12], [10, 12], [8, 12], [6, 8]].forEach(([completed, target], index) => { input.shortsProgress[`C${index + 1}`] = { completed, target, active: null }; });
  return input;
}

test("reported Shorts settings minimise the final target time and include an independent bound", { timeout: 30000 }, async t => {
  const input = screenshotInput();
  const result = await optimizeShorts(input);
  const plan = result.shortsPlan;
  assert.equal(plan.jobs.length, 10);
  assert.equal(plan.totalHours, Math.max(...plan.jobs.map(job => job.endHours)));
  assert.ok(plan.totalHours < plan.baselineHours);
  assert.ok(plan.baselineHours - plan.totalHours > 10 / 3600, "finer crew splits save more than ten seconds");
  assert.ok(plan.certificate.lowerBoundHours <= plan.totalHours);
  assert.ok(plan.certificate.relativeGap >= 0);
  assert.ok(plan.totalHours - plan.certificate.lowerBoundHours < 5 / 3600, "verified within five seconds of the global optimum for these fixed farms");
  assert.equal(plan.certificate.provenOptimal, false, "a small gap is not proof of exact optimality");
  for (const step of plan.steps) {
    for (const type of Object.keys(input.workers)) {
      const farms = result.assignments.filter(row => row.name.startsWith("F") && row.type === type).reduce((sum, row) => sum + row.count, 0);
      const newFarms = plan.farmEvents.filter(event => event.timeHours <= step.timeHours).reduce((sum, event) => sum + event.workers[type], 0);
      assert.ok(farms + newFarms + step.running.reduce((sum, job) => sum + job.workers[type], 0) <= input.workers[type].count);
    }
  }
  assert.ok(!result.assignments.some(row => row.name === "F1-4"), "F1-4 is still locked at C1-10");
  assert.equal(plan.farmEvents.find(event => event.name === "F1-4").timeHours, plan.jobs.find(job => job.name === "C1-12").endHours);
  t.diagnostic(JSON.stringify({ baselineHours: plan.baselineHours, improvedHours: plan.totalHours, certificate: plan.certificate }));
});

test("one normal run improves the early-game schedule without an extra search action", async t => {
  const input = screenshotInput();
  input.searchEffort = "standard";
  input.fragmentsPerCompletion = createDefaultInput().fragmentsPerCompletion;
  input.selectedCampaignFarmMissions = input.selectedCampaignFarmMissions.filter(name => name !== "F1-4");
  [1, 0, 0, 0].forEach((completed, index) => { input.shortsProgress[`C${index + 1}`].completed = completed; });
  // Measured before automatic balancing/polishing was introduced.
  const previousHours = 39.47985826735782;
  const result = await optimizeShorts(input);
  const plan = result.shortsPlan;
  assert.ok(previousHours - plan.totalHours > 15 / 60, "save at least fifteen minutes in the same normal run");
  assert.ok(plan.certificate.relativeGap < 0.025, "tighten the previous 4% certificate without claiming optimality");
  assert.ok(plan.certificate.lowerBoundHours <= plan.totalHours);
  for (const job of plan.jobs) {
    if (job.prerequisite) assert.ok(job.startHours >= plan.jobs.find(prior => prior.name === job.prerequisite).endHours);
    const number = Number(job.name.split("-")[1]);
    const prior = plan.jobs.find(other => other.name === `${job.section}-${number - 1}`);
    if (prior) assert.ok(job.startHours >= prior.endHours);
  }
  for (const step of plan.steps) for (const type of Object.keys(input.workers)) {
    const initialFarms = result.assignments.filter(row => row.name.startsWith("F") && row.type === type).reduce((sum, row) => sum + row.count, 0);
    const unlockedFarms = plan.farmEvents.filter(event => event.timeHours <= step.timeHours).reduce((sum, event) => sum + event.workers[type], 0);
    assert.ok(initialFarms + unlockedFarms + step.running.reduce((sum, job) => sum + job.workers[type], 0) <= input.workers[type].count);
  }
  t.diagnostic(JSON.stringify({ previousHours, improvedHours: plan.totalHours, relativeGap: plan.certificate.relativeGap }));
});
