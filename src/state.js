import { ALL_FARM_MISSIONS, CAMPAIGN_BASE_CAPS, MATS, TYPE_ORDER } from "./data.js?v=3.2.6";
import { CAMPAIGN_SECTIONS, createDefaultInput, getVisibleCampaignNames, validateInput } from "./validation.js?v=3.2.6";

export const STATE_SCHEMA_VERSION = 3;
export const STORAGE_KEY_V3 = "cifi-farm-mission-optimizer-state-v3";
export const STORAGE_KEY_V2 = "cifi-farm-mission-optimizer-state-v2";
export const LEGACY_STORAGE_KEY = "cifi-farm-mission-optimizer-state-v1";

// Turn a personnel name into its saved field key.
function typeKey(type) {
  return String(type).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Clean a saved number and keep it within allowed limits.
function safeNumber(value, { integer = false, max = Infinity } = {}) {
  const parsed = value === "" || value == null ? 0 : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  const normalized = integer ? Math.floor(parsed) : parsed;
  return Math.min(normalized, max);
}

// Read a saved percentage, or use the default if it is invalid.
function safePercentage(value, fallback) {
  if (value === "" || value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return fallback;
  return Math.round(parsed);
}

// Recover mission selections from the older save format.
function selectedFromMap(selection, fallback) {
  if (!selection || typeof selection !== "object") return [...fallback];
  return fallback.filter(name => selection[name] !== false);
}

// Convert old saved settings into the current format.
export function migrateLegacyState(legacy) {
  const defaults = createDefaultInput();
  const values = legacy?.values && typeof legacy.values === "object" ? legacy.values : {};
  const workers = {};
  TYPE_ORDER.forEach(type => {
    const key = typeKey(type);
    workers[type] = {
      power: safeNumber(values[`power-${key}`]),
      count: safeNumber(values[`count-${key}`], { integer: true, max: Number.MAX_SAFE_INTEGER })
    };
  });

  const weights = {};
  MATS.forEach(material => {
    weights[material] = values[`priority-${material}`] === "Boosted" ? 10 : 1;
  });

  return sanitizePersistedInput({
    ouroUnlocked: Boolean(values.ouroToggle),
    workers,
    weights,
    selectedFarmMissions: selectedFromMap(legacy?.missionSelectionState, ALL_FARM_MISSIONS),
    selectedCampaignFarmMissions: selectedFromMap(legacy?.campaignFarmSelectionState, ALL_FARM_MISSIONS),
    mode: values.modeSelect || defaults.mode,
    fragmentsPerCompletion: safeNumber(values.baseFragmentsInput),
    campaignEnabled: Boolean(values.campaignEnabled),
    campaignTargetName: values.campaignTarget || defaults.campaignTargetName,
    relic11Level: safeNumber(values.relic11, { integer: true, max: Number.MAX_SAFE_INTEGER }),
    modifiers: {
      engineeringBadge: Boolean(values.engineeringBadge),
      swarmLevel: safeNumber(values.swarmLevel, { integer: true, max: Number.MAX_SAFE_INTEGER }),
      productivityLevel: safeNumber(values.productivityLevel, { integer: true, max: Number.MAX_SAFE_INTEGER }),
      research58: safeNumber(values.research58, { integer: true, max: 6 }),
      research70: safeNumber(values.research70, { integer: true, max: 6 }),
      research80: safeNumber(values.research80, { integer: true, max: 6 }),
      relic3: safeNumber(values.relic3, { integer: true, max: Number.MAX_SAFE_INTEGER }),
      ts07Enabled: Boolean(values.ts07)
    }
  });
}

// Clean saved settings before using them in the optimiser.
export function sanitizePersistedInput(raw) {
  const defaults = createDefaultInput();
  const source = raw && typeof raw === "object" ? raw : {};
  const workers = {};
  TYPE_ORDER.forEach(type => {
    workers[type] = {
      power: safeNumber(source.workers?.[type]?.power),
      count: safeNumber(source.workers?.[type]?.count, { integer: true, max: Number.MAX_SAFE_INTEGER })
    };
  });
  const modifiers = {
    engineeringBadge: Boolean(source.modifiers?.engineeringBadge),
    swarmLevel: safeNumber(source.modifiers?.swarmLevel, { integer: true, max: Number.MAX_SAFE_INTEGER }),
    productivityLevel: safeNumber(source.modifiers?.productivityLevel, { integer: true, max: Number.MAX_SAFE_INTEGER }),
    research58: safeNumber(source.modifiers?.research58, { integer: true, max: 6 }),
    research70: safeNumber(source.modifiers?.research70, { integer: true, max: 6 }),
    research80: safeNumber(source.modifiers?.research80, { integer: true, max: 6 }),
    relic3: safeNumber(source.modifiers?.relic3, { integer: true, max: Number.MAX_SAFE_INTEGER }),
    ts07Enabled: Boolean(source.modifiers?.ts07Enabled)
  };
  const visibleCampaigns = getVisibleCampaignNames(Boolean(source.ouroUnlocked));
  const locked = Object.fromEntries(TYPE_ORDER.map(type => [type, 0]));
  const shortsProgress = Object.fromEntries(CAMPAIGN_SECTIONS.map(section => {
    const value = source.shortsProgress?.[section];
    const max = visibleCampaigns.filter(name => name.startsWith(`${section}-`)).length;
    const completed = safeNumber(value?.completed, { integer: true, max });
    const target = Math.max(completed, safeNumber(value?.target, { integer: true, max }));
    let active = null;
    if (value?.active && completed < target) {
      const remainingHours = safeNumber(value.active.remainingHours);
      const counts = Object.fromEntries(TYPE_ORDER.map(type => [type, safeNumber(value.active.workers?.[type], { integer: true, max: Number.MAX_SAFE_INTEGER })]));
      const count = Object.values(counts).reduce((sum, amount) => sum + amount, 0);
      const cap = Math.round(CAMPAIGN_BASE_CAPS[`${section}-${completed + 1}`] * (1 + (source.ouroUnlocked ? safeNumber(source.relic11Level, { integer: true }) * 0.5 : 0)));
      if (remainingHours > 0 && count > 0 && count <= cap && TYPE_ORDER.every(type => locked[type] + counts[type] <= workers[type].count)) {
        active = { remainingHours, workers: counts };
        TYPE_ORDER.forEach(type => { locked[type] += counts[type]; });
      }
    }
    return [section, { completed, target, active }];
  }));
  // Move an old single-campaign target into the planner without guessing progress.
  if (source.campaignEnabled && !source.shortsEnabled && visibleCampaigns.includes(source.campaignTargetName)) {
    const [section, stage] = source.campaignTargetName.split("-");
    shortsProgress[section].target = Math.max(shortsProgress[section].target, Number(stage));
  }
  const candidate = {
    ...defaults,
    ...source,
    workers,
    shortsProgress,
    shortsEnabled: Boolean(source.campaignEnabled),
    weights: Object.fromEntries(MATS.map(material => [material, Number(source.weights?.[material]) === 10 ? 10 : 1])),
    hybridFragmentPercent: safePercentage(source.hybridFragmentPercent, defaults.hybridFragmentPercent),
    fragmentsPerCompletion: safeNumber(source.fragmentsPerCompletion),
    relic11Level: safeNumber(source.relic11Level, { integer: true, max: Number.MAX_SAFE_INTEGER }),
    modifiers
  };
  return validateInput(candidate).input;
}

// Package cleaned settings with their format version and save time.
export function createSavedState(input, now = new Date()) {
  return { schemaVersion: STATE_SCHEMA_VERSION, savedAt: now.toISOString(), input: sanitizePersistedInput(input) };
}

// Store the current settings in this browser.
export function saveState(input, storage = window.localStorage) {
  storage.setItem(STORAGE_KEY_V3, JSON.stringify(createSavedState(input)));
}

// Remove this app's saved settings, including older formats.
export function clearState(storage = window.localStorage) {
  storage.removeItem(STORAGE_KEY_V3);
  storage.removeItem(STORAGE_KEY_V2);
  storage.removeItem(LEGACY_STORAGE_KEY);
}

// Load saved settings, upgrade old formats, or fall back to defaults.
export function loadState(storage = window.localStorage) {
  try {
    const currentRaw = storage.getItem(STORAGE_KEY_V3);
    if (currentRaw) {
      const parsed = JSON.parse(currentRaw);
      if (parsed?.schemaVersion === STATE_SCHEMA_VERSION && parsed.input) {
        return { input: sanitizePersistedInput(parsed.input), migrated: false, warning: "" };
      }
      storage.removeItem(STORAGE_KEY_V3);
      return { input: createDefaultInput(), migrated: false, warning: "Saved settings were incompatible and have been reset." };
    }

    const v2Raw = storage.getItem(STORAGE_KEY_V2);
    if (v2Raw) {
      const parsed = JSON.parse(v2Raw);
      if (parsed?.schemaVersion === 2 && parsed.input) {
        const input = sanitizePersistedInput({ ...parsed.input, searchEffort: "standard" });
        saveState(input, storage);
        storage.removeItem(STORAGE_KEY_V2);
        return { input, migrated: true, warning: "Your saved settings were upgraded." };
      }
      storage.removeItem(STORAGE_KEY_V2);
      return { input: createDefaultInput(), migrated: false, warning: "Saved settings were incompatible and have been reset." };
    }

    const legacyRaw = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const input = migrateLegacyState(JSON.parse(legacyRaw));
      saveState(input, storage);
      storage.removeItem(LEGACY_STORAGE_KEY);
      return { input, migrated: true, warning: "Your saved settings were upgraded." };
    }
  } catch {
    try {
      storage.removeItem(STORAGE_KEY_V3);
      storage.removeItem(STORAGE_KEY_V2);
    } catch { /* Storage may be unavailable. */ }
    return { input: createDefaultInput(), migrated: false, warning: "Saved settings could not be read and have been reset." };
  }
  return { input: createDefaultInput(), migrated: false, warning: "" };
}
