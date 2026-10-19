import {
  ALL_CAMPAIGN_MISSIONS,
  ALL_FARM_MISSIONS,
  ALL_MODE_OPTIONS,
  CAMPAIGN_BASE_CAPS,
  isFarmUnlocked,
  MATS,
  OURO_OFF_VISIBLE_CAMPAIGNS,
  OURO_OFF_VISIBLE_FARMS,
  OURO_REQUIRED_MODE_OPTIONS,
  TYPE_ORDER
} from "./data.js?v=3.2.8";
import { SECTION_REQUIREMENTS } from "./campaign-unlocks.js?v=3.2.8";

const DEFAULT_MODE = "Maximising Resources";
const DEFAULT_CAMPAIGN = "C4-11";
export const SEARCH_EFFORTS = Object.freeze(["standard", "crazy"]);
export const CAMPAIGN_SECTIONS = Object.freeze(["C1", "C2", "C3", "C4"]);

// Create the starting settings for a new or reset session.
export function createDefaultInput() {
  return {
    ouroUnlocked: false,
    workers: Object.fromEntries(TYPE_ORDER.map(type => [type, { power: 0, count: 0 }])),
    weights: Object.fromEntries(MATS.map(material => [material, 1])),
    selectedFarmMissions: [...ALL_FARM_MISSIONS],
    selectedCampaignFarmMissions: [...ALL_FARM_MISSIONS],
    mode: DEFAULT_MODE,
    searchEffort: "standard",
    hybridFragmentPercent: 75,
    fragmentsPerCompletion: 0,
    campaignEnabled: false,
    campaignTargetName: DEFAULT_CAMPAIGN,
    shortsEnabled: false,
    awayEnabled: false,
    awayUntil: 0,
    shortsProgress: Object.fromEntries(CAMPAIGN_SECTIONS.map(section => [section, { completed: 0, target: 0, active: null }])),
    relic11Level: 0,
    modifiers: {
      engineeringBadge: false,
      swarmLevel: 0,
      productivityLevel: 0,
      research58: 0,
      research70: 0,
      research80: 0,
      relic3: 0,
      ts07Enabled: false
    }
  };
}

// List farms available with the current Ouroboros unlock.
export function getVisibleFarmNames(ouroUnlocked, progress = null, useTargets = false) {
  return ALL_FARM_MISSIONS.filter(name => (ouroUnlocked || OURO_OFF_VISIBLE_FARMS.has(name)) && (!progress || isFarmUnlocked(name, progress, useTargets)));
}

// List campaigns available with the current Ouroboros unlock.
export function getVisibleCampaignNames(ouroUnlocked) {
  return ALL_CAMPAIGN_MISSIONS.filter(name => ouroUnlocked || OURO_OFF_VISIBLE_CAMPAIGNS.has(name));
}

// List the optimisation modes currently available.
export function getAvailableModes(ouroUnlocked) {
  return ALL_MODE_OPTIONS.filter(mode => ouroUnlocked || !OURO_REQUIRED_MODE_OPTIONS.has(mode));
}

// Read a numeric input, treating an empty field as zero.
function parseNumber(value) {
  if (value === "" || value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

// Remove duplicate and unknown selections.
function uniqueKnown(values, known) {
  const allowed = new Set(known);
  return Array.from(new Set(Array.isArray(values) ? values : [])).filter(value => allowed.has(value));
}

// Record any number that breaks the field's allowed limits.
function checkNumber(errors, field, value, { integer = false, max = Infinity } = {}) {
  if (!Number.isFinite(value)) {
    errors.push({ field, message: "Enter a finite number." });
    return;
  }
  if (value < 0) errors.push({ field, message: "Value cannot be negative." });
  if (integer && !Number.isInteger(value)) errors.push({ field, message: "Enter a whole number." });
  if (value > max) errors.push({ field, message: `Value cannot exceed ${max}.` });
}

/**
 * Check settings and return cleaned inputs with any problems found.
 * @param {unknown} raw
 * @returns {{ input: import('./types.js').OptimizerInput, errors: import('./types.js').ValidationError[] }}
 */
export function validateInput(raw) {
  const defaults = createDefaultInput();
  const source = raw && typeof raw === "object" ? raw : {};
  const ouroUnlocked = Boolean(source.ouroUnlocked);
  const errors = [];
  const workers = {};

  TYPE_ORDER.forEach(type => {
    const candidate = source.workers?.[type] || {};
    const power = parseNumber(candidate.power);
    const count = parseNumber(candidate.count);
    checkNumber(errors, `worker-power-${type}`, power);
    checkNumber(errors, `worker-count-${type}`, count, { integer: true, max: Number.MAX_SAFE_INTEGER });
    workers[type] = { power, count };
  });

  const modifiers = {
    engineeringBadge: Boolean(source.modifiers?.engineeringBadge),
    swarmLevel: parseNumber(source.modifiers?.swarmLevel),
    productivityLevel: parseNumber(source.modifiers?.productivityLevel),
    research58: parseNumber(source.modifiers?.research58),
    research70: parseNumber(source.modifiers?.research70),
    research80: parseNumber(source.modifiers?.research80),
    relic3: ouroUnlocked ? parseNumber(source.modifiers?.relic3) : 0,
    ts07Enabled: ouroUnlocked && Boolean(source.modifiers?.ts07Enabled)
  };
  checkNumber(errors, "swarmLevel", modifiers.swarmLevel, { integer: true, max: Number.MAX_SAFE_INTEGER });
  checkNumber(errors, "productivityLevel", modifiers.productivityLevel, { integer: true, max: Number.MAX_SAFE_INTEGER });
  ["research58", "research70", "research80"].forEach(field => checkNumber(errors, field, modifiers[field], { integer: true, max: 6 }));
  checkNumber(errors, "relic3", modifiers.relic3, { integer: true, max: Number.MAX_SAFE_INTEGER });

  const fragmentsPerCompletion = ouroUnlocked ? parseNumber(source.fragmentsPerCompletion) : 0;
  const relic11Level = ouroUnlocked ? parseNumber(source.relic11Level) : 0;
  checkNumber(errors, "baseFragmentsInput", fragmentsPerCompletion);
  checkNumber(errors, "relic11", relic11Level, { integer: true, max: Number.MAX_SAFE_INTEGER });

  const weights = {};
  MATS.forEach(material => {
    weights[material] = Number(source.weights?.[material]) === 10 ? 10 : 1;
  });

  const availableModes = getAvailableModes(ouroUnlocked);
  const mode = availableModes.includes(source.mode) ? source.mode : DEFAULT_MODE;
  if (source.mode && !availableModes.includes(source.mode)) {
    errors.push({ field: "modeSelect", message: "This mode requires Ouroboros." });
  }
  const searchEffort = SEARCH_EFFORTS.includes(source.searchEffort) ? source.searchEffort : "standard";
  const hybridFragmentPercent = source.hybridFragmentPercent == null
    ? defaults.hybridFragmentPercent
    : parseNumber(source.hybridFragmentPercent);
  checkNumber(errors, "hybridFragmentPercent", hybridFragmentPercent, { integer: true, max: 100 });

  const visibleCampaigns = getVisibleCampaignNames(ouroUnlocked);
  const campaignTargetName = visibleCampaigns.includes(source.campaignTargetName)
    ? source.campaignTargetName
    : (visibleCampaigns.includes(DEFAULT_CAMPAIGN) ? DEFAULT_CAMPAIGN : visibleCampaigns[0]);
  if (source.campaignEnabled && !source.shortsEnabled && source.campaignTargetName && !visibleCampaigns.includes(source.campaignTargetName)) {
    errors.push({ field: "campaignTarget", message: "Select an available campaign target." });
  }

  const selectedFarmMissions = uniqueKnown(source.selectedFarmMissions ?? defaults.selectedFarmMissions, ALL_FARM_MISSIONS);
  const selectedCampaignFarmMissions = uniqueKnown(
    source.selectedCampaignFarmMissions ?? defaults.selectedCampaignFarmMissions,
    ALL_FARM_MISSIONS
  );

  const shortsEnabled = Boolean(source.shortsEnabled);
  const awayEnabled = Boolean(source.awayEnabled);
  const awayUntil = parseNumber(source.awayUntil);
  if (awayEnabled && source.campaignEnabled && shortsEnabled && (!Number.isFinite(awayUntil) || awayUntil <= 0 || awayUntil > 8.64e15)) {
    errors.push({ field: "awayUntil", message: "Choose a valid return date and time." });
  }
  const shortsProgress = {};
  const locked = Object.fromEntries(TYPE_ORDER.map(type => [type, 0]));
  for (const section of CAMPAIGN_SECTIONS) {
    const value = source.shortsProgress?.[section] || defaults.shortsProgress[section];
    const max = Math.max(0, ...visibleCampaigns.filter(name => name.startsWith(`${section}-`)).map(name => Number(name.split("-")[1])));
    const completed = parseNumber(value.completed);
    const target = parseNumber(value.target);
    const sectionErrors = [];
    checkNumber(sectionErrors, `shorts-completed-${section}`, completed, { integer: true, max });
    checkNumber(sectionErrors, `shorts-target-${section}`, target, { integer: true, max });
    if (target < completed) sectionErrors.push({ field: `shorts-target-${section}`, message: "Target must be at or after the last completed campaign." });
    let active = null;
    if (value.active) {
      const remainingHours = parseNumber(value.active.remainingHours);
      if (!Number.isFinite(remainingHours)) sectionErrors.push({ field: `shorts-hours-${section}`, message: "Enter time as HH:MM:SS (e.g. 02:30:00)." });
      else checkNumber(sectionErrors, `shorts-hours-${section}`, remainingHours);
      if (remainingHours === 0) sectionErrors.push({ field: `shorts-hours-${section}`, message: "Enter the running campaign's remaining time, or clear Running." });
      const counts = Object.fromEntries(TYPE_ORDER.map((type, index) => {
        const count = parseNumber(value.active.workers?.[type]);
        checkNumber(sectionErrors, `shorts-active-${section}-${index}`, count, { integer: true, max: Number.MAX_SAFE_INTEGER });
        locked[type] += count;
        return [type, count];
      }));
      const assigned = Object.values(counts).reduce((sum, count) => sum + count, 0);
      const cap = Math.round((CAMPAIGN_BASE_CAPS[`${section}-${completed + 1}`] || 0) * (1 + relic11Level * 0.5));
      if (assigned <= 0 || assigned > cap || completed >= target) sectionErrors.push({ field: `shorts-running-${section}`, message: "A running campaign needs workers within its cap and must be within the selected target." });
      active = { remainingHours, workers: counts };
    }
    shortsProgress[section] = { completed, target, active };
    if (source.campaignEnabled && shortsEnabled) errors.push(...sectionErrors);
  }
  if (source.campaignEnabled && shortsEnabled) {
    for (const [section, required] of Object.entries(SECTION_REQUIREMENTS)) {
      if (shortsProgress[section].active && shortsProgress[required.section].completed < required.stage) {
        errors.push({ field: `shorts-running-${section}`, message: `${required.section}-${required.stage} must be marked completed before a ${section} campaign can already be running.` });
      }
    }
    TYPE_ORDER.forEach(type => {
      if (locked[type] > workers[type].count) errors.push({ field: `worker-count-${type}`, message: "Total workers must include everyone locked in running campaigns." });
    });
  }

  return {
    input: {
      ouroUnlocked,
      workers,
      weights,
      selectedFarmMissions,
      selectedCampaignFarmMissions,
      mode,
      searchEffort,
      hybridFragmentPercent,
      fragmentsPerCompletion,
      campaignEnabled: Boolean(source.campaignEnabled),
      campaignTargetName,
      shortsEnabled,
      awayEnabled,
      awayUntil: Number.isFinite(awayUntil) && awayUntil > 0 && awayUntil <= 8.64e15 ? awayUntil : 0,
      shortsProgress,
      relic11Level,
      modifiers
    },
    errors
  };
}

// Combine all active bonuses into the overall mission speed.
export function calculateGlobalSpeedMultiplier(input) {
  const { modifiers, ouroUnlocked } = input;
  let multiplier = modifiers.engineeringBadge ? 2 : 1;
  multiplier *= Math.pow(1.0311, modifiers.swarmLevel);
  multiplier *= Math.pow(1.1, modifiers.productivityLevel);
  multiplier *= modifiers.research58 >= 1 ? 1.05 : 1;
  multiplier *= modifiers.research58 >= 3 ? 1.05 : 1;
  multiplier *= modifiers.research58 >= 5 ? 1.05 : 1;
  multiplier *= modifiers.research70 >= 5 ? 2 : 1;
  multiplier *= modifiers.research80 >= 5 ? 1.5 : 1;
  if (ouroUnlocked) multiplier *= modifiers.relic3 * 0.03 + 1;
  return multiplier;
}
