import { MATS, MISSION_DATA, TYPE_ORDER, getFx4FragmentBonusMultiplier } from "./data.js?v=3.2.5";
import { calculateGlobalSpeedMultiplier, getVisibleFarmNames } from "./validation.js?v=3.2.5";

export function reserveTrackedFarms(input, assignments) {
  const visible = getVisibleFarmNames(input.ouroUnlocked, input.shortsProgress);
  const workers = structuredClone(input.workers);
  const sizes = new Map();
  for (const row of assignments) {
    if (!visible.includes(row.name) || !TYPE_ORDER.includes(row.type) || !Number.isSafeInteger(row.count) || row.count <= 0) throw new Error("A recorded farm assignment is invalid. Check your tracked farms.");
    sizes.set(row.name, (sizes.get(row.name) || 0) + row.count);
    workers[row.type].count -= row.count;
  }
  for (const [name, size] of sizes) {
    if (size > MISSION_DATA.find(mission => mission.name === name).cap) throw new Error(`${name} exceeds its worker capacity.`);
  }
  for (const type of TYPE_ORDER) {
    const running = Object.values(input.shortsProgress).reduce((sum, section) => sum + (section.active?.workers[type] || 0), 0);
    if (workers[type].count < running) throw new Error(`Total ${type} count must include workers in tracked farms and running campaigns.`);
  }
  return { ...input, workers, selectedCampaignFarmMissions: input.selectedCampaignFarmMissions.filter(name => !sizes.has(name)) };
}

export function mergeTrackedFarms(result, input, assignments) {
  const totals = { ...result.totals };
  const power = new Map();
  assignments.forEach(row => power.set(row.name, (power.get(row.name) || 0) + row.count * input.workers[row.type].power));
  const speed = calculateGlobalSpeedMultiplier(input);
  const rewardsMult = input.ouroUnlocked && input.modifiers.ts07Enabled ? 2 : 1;
  for (const [name, value] of power) {
    const mission = MISSION_DATA.find(row => row.name === name);
    const runs = value > 0 ? 60 / Math.max(mission.minutes / (speed * value), 2 / 60) : 0;
    totals.Completions += runs * rewardsMult;
    totals.Academy += runs * rewardsMult * mission.academy;
    totals.Fragments += runs * (input.fragmentsPerCompletion + (getFx4FragmentBonusMultiplier(name) * input.fragmentsPerCompletion || mission.fragments || 0));
    MATS.forEach(material => { totals[material] += runs * rewardsMult * (mission.rewards[material] || 0); });
  }
  const selectedFarmNames = [...new Set([...power.keys(), ...result.selectedFarmNames])];
  return { ...result, assignments: [...assignments, ...result.assignments], totals, selectedFarmNames, selectedFarmCount: selectedFarmNames.length };
}
