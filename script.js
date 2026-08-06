import {
  ALL_FARM_MISSIONS,
  MATS,
  TYPE_ORDER
} from "./src/data.js?v=3.0.2";
import { canonicalStringify } from "./src/random.js?v=3.0.2";
import { clearState, loadState, saveState } from "./src/state.js?v=3.0.2";
import { OptimizerCancelledError, OptimizerWorkerClient } from "./src/worker-client.js?v=3.0.2";
import {
  createDefaultInput,
  getAvailableModes,
  getVisibleCampaignNames,
  getVisibleFarmNames,
  validateInput
} from "./src/validation.js?v=3.0.2";

const APP_VERSION = "3.0.2";
const elements = new Map();
const byId = id => {
  if (!elements.has(id)) elements.set(id, document.getElementById(id));
  return elements.get(id);
};

const typeKey = type => String(type).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const fieldId = field => {
  if (field.startsWith("worker-power-")) return `power-${typeKey(field.slice(13))}`;
  if (field.startsWith("worker-count-")) return `count-${typeKey(field.slice(13))}`;
  return field;
};

let selectedFarmMissions = new Set();
let selectedCampaignFarmMissions = new Set();
let saveTimer = null;
let suppressNextCancellationStatus = false;
const workerClient = new OptimizerWorkerClient(() => {
  if (!window.Worker) throw new Error("This browser does not support background optimisation.");
  return new Worker(new URL("./src/worker.js?v=3.0.2", import.meta.url), { type: "module" });
});

function setTab(button, focus = false) {
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    const active = tab === button;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    const panel = byId(tab.dataset.tab);
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
  if (focus) button.focus();
}

function initialiseTabs() {
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => setTab(tab));
    tab.addEventListener("keydown", event => {
      let nextIndex = index;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      else return;
      event.preventDefault();
      setTab(tabs[nextIndex], true);
    });
  });
}

function initialiseSectionJumps() {
  document.querySelectorAll(".jump-button").forEach(button => {
    button.addEventListener("click", () => byId(button.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
}

function renderModeOptions(preferred = byId("modeSelect").value) {
  const options = getAvailableModes(byId("ouroToggle").checked);
  byId("modeSelect").replaceChildren(...options.map(mode => new Option(mode, mode)));
  byId("modeSelect").value = options.includes(preferred) ? preferred : "Maximising Resources";
}

function renderCampaignTargets(preferred = byId("campaignTarget").value) {
  const names = getVisibleCampaignNames(byId("ouroToggle").checked);
  byId("campaignTarget").replaceChildren(...names.map(name => new Option(name, name)));
  byId("campaignTarget").value = names.includes(preferred) ? preferred : (names.includes("C4-11") ? "C4-11" : names[0]);
}

function createMissionTierMarkup(names, selected, inputClass) {
  const tiers = { F1: [], F2: [], F3: [], F4: [] };
  names.forEach(name => tiers[name.split("-")[0]]?.push(name));
  return Object.entries(tiers).filter(([, tierNames]) => tierNames.length).map(([tier, tierNames]) => {
    const selectedCount = tierNames.filter(name => selected.has(name)).length;
    const tiles = tierNames.map(name => `
      <label class="mission-tile ${selected.has(name) ? "is-checked" : ""}">
        <input class="mission-tile-input ${inputClass}" type="checkbox" value="${name}" ${selected.has(name) ? "checked" : ""} />
        <span>${name}</span>
      </label>`).join("");
    return `<div class="mission-tier-card">
      <div class="mission-tier-header"><h3>${tier}</h3><span class="mission-tier-count">${selectedCount} selected</span></div>
      <div class="mission-tile-grid">${tiles}</div>
    </div>`;
  }).join("");
}

function renderFarmMissions() {
  const visible = getVisibleFarmNames(byId("ouroToggle").checked);
  const container = byId("farmMissionSelectionGrid");
  container.innerHTML = createMissionTierMarkup(visible, selectedFarmMissions, "farm-mission-input") ||
    '<div class="mission-tier-empty">No farm missions are currently visible.</div>';
  container.querySelectorAll(".farm-mission-input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) selectedFarmMissions.add(input.value);
      else selectedFarmMissions.delete(input.value);
      renderFarmMissions();
      renderCampaignFarmMissions();
      scheduleSave();
    });
  });
}

function renderCampaignFarmMissions() {
  const container = byId("campaignFarmMissionSelectionGrid");
  if (!byId("campaignEnabled").checked) {
    container.replaceChildren();
    return;
  }
  const visible = getVisibleFarmNames(byId("ouroToggle").checked).filter(name => selectedFarmMissions.has(name));
  container.innerHTML = createMissionTierMarkup(visible, selectedCampaignFarmMissions, "campaign-farm-input") ||
    '<div class="mission-tier-empty">No unlocked farm missions are selected.</div>';
  container.querySelectorAll(".campaign-farm-input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) selectedCampaignFarmMissions.add(input.value);
      else selectedCampaignFarmMissions.delete(input.value);
      renderCampaignFarmMissions();
      scheduleSave();
    });
  });
}

function syncConditionalVisibility() {
  const ouro = byId("ouroToggle").checked;
  const campaign = byId("campaignEnabled").checked;
  const hybrid = byId("modeSelect").value === "Fragments + Resources";
  document.querySelectorAll(".ouro-only, .campaign-enabled-only, .hybrid-mode-only").forEach(element => {
    const visible = (!element.classList.contains("ouro-only") || ouro) &&
      (!element.classList.contains("campaign-enabled-only") || campaign) &&
      (!element.classList.contains("hybrid-mode-only") || hybrid);
    element.classList.toggle("hidden", !visible);
    if (element.matches("section, div.field-card")) element.setAttribute("aria-hidden", String(!visible));
  });
  byId("hybridWeightControl").setAttribute("aria-hidden", String(!(ouro && hybrid)));
  renderCampaignFarmMissions();
}

function updateHybridWeightDisplay() {
  const slider = byId("hybridFragmentPercent");
  const fragments = Math.min(100, Math.max(0, Math.round(Number(slider.value) || 0)));
  const resources = 100 - fragments;
  slider.value = String(fragments);
  slider.style.setProperty("--fragment-weight", `${fragments}%`);
  slider.setAttribute("aria-valuetext", `${fragments}% fragments, ${resources}% resources`);
  byId("hybridFragmentPercentText").value = `${fragments}%`;
  byId("hybridResourcePercentText").value = `${resources}%`;
}

function readFormInput() {
  const workers = {};
  TYPE_ORDER.forEach(type => {
    const key = typeKey(type);
    workers[type] = { power: byId(`power-${key}`).value, count: byId(`count-${key}`).value };
  });
  const weights = Object.fromEntries(MATS.map(material => [material, byId(`priority-${material}`).value === "Boosted" ? 10 : 1]));
  return {
    ouroUnlocked: byId("ouroToggle").checked,
    workers,
    weights,
    selectedFarmMissions: [...selectedFarmMissions],
    selectedCampaignFarmMissions: [...selectedCampaignFarmMissions].filter(name => selectedFarmMissions.has(name)),
    mode: byId("modeSelect").value,
    searchEffort: byId("searchEffort").checked ? "crazy" : "standard",
    hybridFragmentPercent: byId("hybridFragmentPercent").value,
    fragmentsPerCompletion: byId("baseFragmentsInput").value,
    campaignEnabled: byId("campaignEnabled").checked,
    campaignTargetName: byId("campaignTarget").value,
    relic11Level: byId("relic11").value,
    modifiers: {
      engineeringBadge: byId("engineeringBadge").checked,
      swarmLevel: byId("swarmLevel").value,
      productivityLevel: byId("productivityLevel").value,
      research58: byId("research58").value,
      research70: byId("research70").value,
      research80: byId("research80").value,
      relic3: byId("relic3").value,
      ts07Enabled: byId("ts07").checked
    }
  };
}

function applyInput(input) {
  byId("ouroToggle").checked = input.ouroUnlocked;
  renderModeOptions(input.mode);
  byId("searchEffort").checked = input.searchEffort === "crazy";
  byId("hybridFragmentPercent").value = input.hybridFragmentPercent;
  updateHybridWeightDisplay();
  renderCampaignTargets(input.campaignTargetName);
  TYPE_ORDER.forEach(type => {
    const key = typeKey(type);
    byId(`power-${key}`).value = input.workers[type].power;
    byId(`count-${key}`).value = input.workers[type].count;
  });
  MATS.forEach(material => { byId(`priority-${material}`).value = input.weights[material] === 10 ? "Boosted" : "Normal"; });
  selectedFarmMissions = new Set(input.selectedFarmMissions);
  selectedCampaignFarmMissions = new Set(input.selectedCampaignFarmMissions);
  byId("campaignEnabled").checked = input.campaignEnabled;
  byId("campaignTarget").value = input.campaignTargetName;
  byId("relic11").value = input.relic11Level;
  byId("baseFragmentsInput").value = input.fragmentsPerCompletion;
  byId("engineeringBadge").checked = input.modifiers.engineeringBadge;
  byId("swarmLevel").value = input.modifiers.swarmLevel;
  byId("productivityLevel").value = input.modifiers.productivityLevel;
  byId("research58").value = input.modifiers.research58;
  byId("research70").value = input.modifiers.research70;
  byId("research80").value = input.modifiers.research80;
  byId("relic3").value = input.modifiers.relic3;
  byId("ts07").checked = input.modifiers.ts07Enabled;
  renderFarmMissions();
  syncConditionalVisibility();
}

function clearValidation() {
  document.querySelectorAll("[aria-invalid='true']").forEach(element => {
    element.removeAttribute("aria-invalid");
    element.removeAttribute("aria-describedby");
  });
  document.querySelectorAll(".input-error").forEach(element => element.remove());
  byId("validationSummary").classList.add("hidden");
  byId("validationList").replaceChildren();
}

function showValidation(errors) {
  clearValidation();
  const seen = new Set();
  errors.forEach(error => {
    const id = fieldId(error.field);
    if (seen.has(`${id}:${error.message}`)) return;
    seen.add(`${id}:${error.message}`);
    const control = byId(id);
    if (control) {
      control.setAttribute("aria-invalid", "true");
      const message = document.createElement("p");
      message.className = "input-error";
      message.id = `${id}-error`;
      message.textContent = error.message;
      control.setAttribute("aria-describedby", message.id);
      control.insertAdjacentElement("afterend", message);
    }
    const item = document.createElement("li");
    if (control) {
      const link = document.createElement("a");
      link.href = `#${id}`;
      link.textContent = error.message;
      link.addEventListener("click", () => setTimeout(() => control.focus(), 0));
      item.append(link);
    } else item.textContent = error.message;
    byId("validationList").append(item);
  });
  byId("validationSummary").classList.remove("hidden");
  byId("validationSummary").focus();
}

function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistCurrentIfValid, 180);
}

function persistCurrentIfValid() {
  const { input, errors } = validateInput(readFormInput());
  if (!errors.length) persistInput(input);
}

function persistInput(input) {
  try {
    saveState(input);
    return true;
  } catch {
    showNotice("This browser could not save your settings locally.");
    return false;
  }
}

function showNotice(message) {
  byId("stateNotice").textContent = message;
  byId("stateNotice").classList.toggle("hidden", !message);
}

function setRunning(running) {
  byId("runOptimizerBtn").disabled = running;
  byId("resetInputsBtn").disabled = running;
  byId("cancelOptimizerBtn").classList.toggle("hidden", !running);
  byId("optimizerProgress").classList.toggle("hidden", !running);
}

function setStatus(text) {
  byId("statusText").textContent = text;
}

function updateProgress(progress) {
  const basePhase = String(progress.phase || "").replace(/^standard-/, "");
  const labels = {
    preparing: "Preparing…",
    "estimating-ideals": "Estimating hybrid ideals…",
    optimising: "Optimising farms…",
    polishing: "Polishing allocation…",
    campaign: "Assigning campaign remainder…",
    "loading-solver": "Loading Crazy solver…",
    "crazy-fragment-ideal": "Proving fragment ideal…",
    "crazy-resource-ideal": "Proving resource ideal…",
    "crazy-primary": "Crazy search — proving primary objective…",
    "crazy-tiebreak": "Crazy search — proving tie-break…",
    complete: "Completing…"
  };
  setStatus(labels[progress.phase] || labels[basePhase] || "Optimising…");
  const total = Math.max(1, progress.total || 1);
  byId("optimizerProgress").max = total;
  byId("optimizerProgress").value = Math.min(total, progress.completed || 0);
}

async function runOptimizer() {
  clearValidation();
  showNotice("");
  const { input, errors } = validateInput(readFormInput());
  if (errors.length) {
    showValidation(errors);
    setStatus("Check inputs");
    return;
  }
  persistInput(input);
  try {
    setRunning(true);
    setStatus("Preparing…");
    byId("optimizerProgress").value = 0;
    const result = await workerClient.run(input, { onProgress: updateProgress });
    if (suppressNextCancellationStatus) {
      suppressNextCancellationStatus = false;
      setRunning(false);
      return;
    }
    setRunning(false);
    renderResult(result);
    setStatus(result.solutionStatus === "cancelled-best" ? "Cancelled — best found" : "Completed");
    byId("output").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setRunning(false);
    if (error instanceof OptimizerCancelledError) {
      if (suppressNextCancellationStatus) suppressNextCancellationStatus = false;
      else setStatus("Cancelled");
      return;
    }
    if (error.errors?.length) showValidation(error.errors);
    setStatus("Error");
    showNotice(error.message || "The optimiser failed.");
  }
}

function cancelOptimizer() {
  setStatus("Cancelling…");
  workerClient.cancel();
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function formatSelectedFarms(names) {
  if (!names.length) return "None selected";
  const groups = new Map();
  const unmatched = [];
  names.forEach(name => {
    const match = name.match(/^(.+)-(\d+)$/);
    if (!match) {
      unmatched.push(name);
      return;
    }
    if (!groups.has(match[1])) groups.set(match[1], []);
    groups.get(match[1]).push(Number(match[2]));
  });
  const compact = [];
  groups.forEach((values, prefix) => {
    const numbers = [...new Set(values)].sort((a, b) => a - b);
    let start = numbers[0];
    let end = start;
    const appendRange = () => compact.push(start === end ? `${prefix}-${start}` : `${prefix}-${start}–${end}`);
    for (let index = 1; index < numbers.length; index++) {
      if (numbers[index] === end + 1) {
        end = numbers[index];
      } else {
        appendRange();
        start = numbers[index];
        end = start;
      }
    }
    appendRange();
  });
  return [...compact, ...unmatched].join(" · ");
}

function renderResult(result) {
  byId("campaignEtaText").textContent = formatNumber(result.campaignETA, 3);
  byId("modeUsedText").textContent = result.modeUsed;
  byId("elapsedText").textContent = `${formatNumber(result.durationMs, 0)} ms`;
  byId("selectedFarmCountText").textContent = `${result.selectedFarmCount} ${result.selectedFarmCount === 1 ? "farm" : "farms"}`;
  byId("selectedFarmNamesText").textContent = formatSelectedFarms(result.selectedFarmNames);

  const notices = byId("resultNotices");
  notices.replaceChildren(...result.notices.map(text => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  notices.classList.toggle("hidden", result.notices.length === 0);

  const rows = new Map();
  result.assignments.forEach(assignment => {
    if (!rows.has(assignment.name)) rows.set(assignment.name, Object.fromEntries(TYPE_ORDER.map(type => [type, 0])));
    rows.get(assignment.name)[assignment.type] = assignment.count;
  });
  byId("distributionBody").innerHTML = rows.size ? Array.from(rows, ([name, counts]) => `
    <tr><td>${name}</td>${TYPE_ORDER.map(type => `<td data-label="${type}">${counts[type] ? formatNumber(counts[type], 0) : '<span class="zero-cell">-</span>'}</td>`).join("")}</tr>`).join("") :
    '<tr><td colspan="5">No assignments were generated. Review the notices and selected missions above.</td></tr>';

  const totalRows = MATS.map(material => [material, result.totals[material] || 0]);
  totalRows.push(["Academy Pts", result.totals.Academy || 0], ["Completions", result.totals.Completions || 0], ["Fragments (est.)", result.totals.Fragments || 0]);
  byId("totalsBody").innerHTML = totalRows.map(([label, value]) => `<tr><td>${label}</td><td data-label="Value">${formatNumber(value, label.startsWith("Fragments") ? 3 : 1)}</td></tr>`).join("");
  byId("unassignedBody").innerHTML = TYPE_ORDER.map(type => `<tr><td>${type}</td><td data-label="Remaining">${formatNumber(result.unassignedWorkers[type] || 0, 0)}</td></tr>`).join("");
}

function clearOutput() {
  ["campaignEtaText", "modeUsedText", "elapsedText", "selectedFarmCountText", "selectedFarmNamesText"].forEach(id => { byId(id).textContent = "—"; });
  byId("distributionBody").innerHTML = '<tr><td colspan="5">Run the optimizer to populate mission distribution.</td></tr>';
  byId("totalsBody").innerHTML = '<tr><td colspan="2">Run the optimizer to populate totals.</td></tr>';
  byId("unassignedBody").innerHTML = '<tr><td colspan="2">Run the optimizer to show remaining personnel.</td></tr>';
  byId("resultNotices").replaceChildren();
  byId("resultNotices").classList.add("hidden");
  setStatus("Ready");
}

function resetInputs() {
  const current = validateInput(readFormInput()).input;
  const defaults = createDefaultInput();
  if (canonicalStringify(current) !== canonicalStringify(defaults) && !window.confirm("Reset all optimiser inputs and clear saved settings?")) return;
  if (workerClient.isRunning) suppressNextCancellationStatus = true;
  cancelOptimizer();
  let resetWarning = "";
  try { clearState(); } catch { resetWarning = "Saved settings could not be cleared in this browser."; }
  clearValidation();
  applyInput(defaults);
  clearOutput();
  showNotice(resetWarning);
}

function initialiseSelectionButtons() {
  byId("missionSelectAllBtn").addEventListener("click", () => {
    getVisibleFarmNames(byId("ouroToggle").checked).forEach(name => selectedFarmMissions.add(name));
    renderFarmMissions(); renderCampaignFarmMissions(); scheduleSave();
  });
  byId("missionClearAllBtn").addEventListener("click", () => {
    getVisibleFarmNames(byId("ouroToggle").checked).forEach(name => selectedFarmMissions.delete(name));
    renderFarmMissions(); renderCampaignFarmMissions(); scheduleSave();
  });
  byId("campaignFarmSelectAllBtn").addEventListener("click", () => {
    getVisibleFarmNames(byId("ouroToggle").checked).filter(name => selectedFarmMissions.has(name)).forEach(name => selectedCampaignFarmMissions.add(name));
    renderCampaignFarmMissions(); scheduleSave();
  });
  byId("campaignFarmClearAllBtn").addEventListener("click", () => {
    getVisibleFarmNames(byId("ouroToggle").checked).forEach(name => selectedCampaignFarmMissions.delete(name));
    renderCampaignFarmMissions(); scheduleSave();
  });
}

function initialiseForm() {
  byId("ouroToggle").addEventListener("change", () => {
    const mode = byId("modeSelect").value;
    const target = byId("campaignTarget").value;
    renderModeOptions(mode);
    renderCampaignTargets(target);
    renderFarmMissions();
    syncConditionalVisibility();
    scheduleSave();
  });
  byId("campaignEnabled").addEventListener("change", () => { syncConditionalVisibility(); scheduleSave(); });
  byId("modeSelect").addEventListener("change", syncConditionalVisibility);
  byId("hybridFragmentPercent").addEventListener("input", updateHybridWeightDisplay);
  byId("runOptimizerBtn").addEventListener("click", runOptimizer);
  byId("cancelOptimizerBtn").addEventListener("click", cancelOptimizer);
  byId("resetInputsBtn").addEventListener("click", resetInputs);
  byId("optimizer").addEventListener("input", event => {
    if (event.target.matches("input[id], select[id]")) scheduleSave();
  });
  byId("optimizer").addEventListener("change", event => {
    if (event.target.matches("input[id], select[id]")) {
      window.clearTimeout(saveTimer);
      persistCurrentIfValid();
    }
  });
  window.addEventListener("pagehide", persistCurrentIfValid);
}

function initialise() {
  initialiseTabs();
  initialiseSectionJumps();
  initialiseSelectionButtons();
  initialiseForm();
  const loaded = loadState();
  applyInput(loaded.input);
  clearOutput();
  showNotice(loaded.warning);
  document.documentElement.dataset.appVersion = APP_VERSION;
}

initialise();
