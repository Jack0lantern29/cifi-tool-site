import {
  ALL_CAMPAIGN_MISSIONS,
  ALL_FARM_MISSIONS,
  ALL_MODE_OPTIONS,
  MATS,
  OURO_OFF_VISIBLE_CAMPAIGNS,
  OURO_OFF_VISIBLE_FARMS,
  OURO_REQUIRED_MODE_OPTIONS,
  TYPE_ORDER
} from "./data.js?v=3.0.2";

const DEFAULT_MODE = "Maximising Resources";
const DEFAULT_CAMPAIGN = "C4-11";
export const SEARCH_EFFORTS = Object.freeze(["standard", "crazy"]);

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

export function getVisibleFarmNames(ouroUnlocked) {
  return ALL_FARM_MISSIONS.filter(name => ouroUnlocked || OURO_OFF_VISIBLE_FARMS.has(name));
}

export function getVisibleCampaignNames(ouroUnlocked) {
  return ALL_CAMPAIGN_MISSIONS.filter(name => ouroUnlocked || OURO_OFF_VISIBLE_CAMPAIGNS.has(name));
}

export function getAvailableModes(ouroUnlocked) {
  return ALL_MODE_OPTIONS.filter(mode => ouroUnlocked || !OURO_REQUIRED_MODE_OPTIONS.has(mode));
}

function parseNumber(value) {
  if (value === "" || value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

function uniqueKnown(values, known) {
  const allowed = new Set(known);
  return Array.from(new Set(Array.isArray(values) ? values : [])).filter(value => allowed.has(value));
}

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
 * Validate untrusted UI or saved-state input and return the canonical optimiser input.
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
  if (source.campaignEnabled && source.campaignTargetName && !visibleCampaigns.includes(source.campaignTargetName)) {
    errors.push({ field: "campaignTarget", message: "Select an available campaign target." });
  }

  const selectedFarmMissions = uniqueKnown(source.selectedFarmMissions ?? defaults.selectedFarmMissions, ALL_FARM_MISSIONS);
  const selectedCampaignFarmMissions = uniqueKnown(
    source.selectedCampaignFarmMissions ?? defaults.selectedCampaignFarmMissions,
    selectedFarmMissions
  );

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
      relic11Level,
      modifiers
    },
    errors
  };
}

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
