import {
  farmUnlockCampaign,
  MATS,
  TYPE_ORDER
} from "./src/data.js?v=3.2.4";
import { canonicalStringify } from "./src/random.js?v=3.2.4";
import { progressAtShortsStep } from "./src/shorts-progress.js?v=3.2.4";
import { etaTimestamp, formatLocalETA } from "./src/eta.js?v=3.2.4";
import { DURATION_PATTERN, parseRemainingTime, formatRemainingTime } from "./src/duration-input.js?v=3.2.4";
import { createTracker, transitionTracker, trackerActions, trackerProgress, trackerSettingsKey, prepareTrackerUpdate, mergeTrackerUpdate, saveTracker, loadTracker, clearTracker, pendingNotifications, TRACKER_STORAGE_KEY } from "./src/shorts-tracker.js?v=3.2.4";
import { createTrackerView, SECTION_TITLES } from "./src/tracker-view.js?v=3.2.4";
import { buildProgressView, formatDuration, formatSolverUpdateAge, formatSolverWork } from "./src/progress.js?v=3.2.4";
import { clearState, loadState, saveState } from "./src/state.js?v=3.2.4";
import { OptimizerCancelledError, OptimizerWorkerClient } from "./src/worker-client.js?v=3.2.4";
import {
  createDefaultInput,
  CAMPAIGN_SECTIONS,
  getAvailableModes,
  getVisibleCampaignNames,
  getVisibleFarmNames,
  validateInput
} from "./src/validation.js?v=3.2.4";

const APP_VERSION = "3.2.4";
const elements = new Map();
// Find a page element and remember it for later use.
const byId = id => {
  if (!elements.has(id)) elements.set(id, document.getElementById(id));
  return elements.get(id);
};

// Turn a personnel name into a field ID.
const typeKey = type => String(type).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Match an input error to its page field.
const fieldId = field => {
  if (field.startsWith("worker-power-")) return `power-${typeKey(field.slice(13))}`;
  if (field.startsWith("worker-count-")) return `count-${typeKey(field.slice(13))}`;
  return field;
};

let selectedFarmMissions = new Set();
let selectedCampaignFarmMissions = new Set();
let shortsInputSnapshot = null;
let tracker = null;
let trackerView = null;
let trackingPreview = null;
let trackerEpoch = 0;
let notificationFailure = false;
let saveTimer = null;
let suppressNextCancellationStatus = false;
let progressTimer = null;
let progressStartedAt = null;
let latestProgress = null;
let lastSolverUpdateAt = null;
let lastSolverUpdate = 0;
const workerClient = new OptimizerWorkerClient(() => {
  if (!window.Worker) throw new Error("This browser does not support background optimisation.");
  return new Worker(new URL("./src/worker.js?v=3.2.4", import.meta.url), { type: "module" });
});

// Show the selected tab and optionally move focus to it.
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
  updateFloatingOptimizer();
}

function updateFloatingOptimizer() {
  const rect = byId("runOptimizerBtn").getBoundingClientRect();
  const topVisible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  byId("floatingOptimizerBtn").classList.toggle("hidden", byId("optimizer").hidden || topVisible);
}

function initialiseFloatingOptimizer() {
  byId("floatingOptimizerBtn").addEventListener("click", runOptimizer);
  if (window.IntersectionObserver) {
    const observer = new IntersectionObserver(updateFloatingOptimizer, { threshold: [0, 1] });
    observer.observe(byId("runOptimizerBtn"));
  }
  // Resize and scroll also cover partial visibility and browsers without observers.
  let pending = false;
  const update = () => {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(() => { pending = false; updateFloatingOptimizer(); });
  };
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  updateFloatingOptimizer();
}

// Connect tab buttons and keyboard navigation.
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

// Connect the shortcuts that scroll to each section.
function initialiseSectionJumps() {
  document.querySelectorAll(".jump-button").forEach(button => {
    button.addEventListener("click", () => byId(button.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  });
}

// Show the modes available with the current unlocks.
function renderModeOptions(preferred = byId("modeSelect").value) {
  const options = getAvailableModes(byId("ouroToggle").checked);
  byId("modeSelect").replaceChildren(...options.map(mode => new Option(mode, mode)));
  byId("modeSelect").value = options.includes(preferred) ? preferred : "Maximising Resources";
}

// Show available campaign targets and keep the current choice when possible.
function renderCampaignTargets(preferred = byId("campaignTarget").value) {
  const names = getVisibleCampaignNames(byId("ouroToggle").checked);
  byId("campaignTarget").replaceChildren(...names.map(name => new Option(name, name)));
  byId("campaignTarget").value = names.includes(preferred) ? preferred : (names.includes("C4-11") ? "C4-11" : names[0]);
}

function readShortsProgress() {
  return Object.fromEntries(CAMPAIGN_SECTIONS.map(section => [section, {
    completed: Number(byId(`shorts-completed-${section}`).value),
    target: Number(byId(`shorts-target-${section}`).value),
    active: byId(`shorts-running-${section}`).checked ? {
      remainingHours: parseRemainingTime(byId(`shorts-hours-${section}`).value),
      workers: Object.fromEntries(TYPE_ORDER.map((type, index) => [type, byId(`shorts-active-${section}-${index}`).value]))
    } : null
  }]));
}

function renderShortsControls(progress = createDefaultInput().shortsProgress) {
  const visible = getVisibleCampaignNames(byId("ouroToggle").checked);
  // Controls are recreated on unlock/progress changes; discard cached elements.
  [...elements.keys()].filter(key => key.startsWith("shorts-")).forEach(key => elements.delete(key));
  byId("shortsProgressGrid").innerHTML = CAMPAIGN_SECTIONS.map(section => {
    const names = visible.filter(name => name.startsWith(`${section}-`));
    const max = names.length;
    const entry = progress[section];
    const completed = Math.min(max, entry.completed);
    const target = Math.max(completed, Math.min(max, entry.target));
    const options = (selected, emptyLabel) => `<option value="0"${selected === 0 ? " selected" : ""}>${emptyLabel}</option>` + names.map((name, index) => `<option value="${index + 1}"${selected === index + 1 ? " selected" : ""}>${name}</option>`).join("");
    return `<fieldset class="shorts-section"${max ? "" : " disabled hidden"}>
      <legend>${SECTION_TITLES[section]}</legend>
      <label class="field-label" for="shorts-completed-${section}">Last completed</label>
      <select id="shorts-completed-${section}">${options(completed, "None completed")}</select>
      <label class="field-label" for="shorts-target-${section}">Target campaign</label>
      <select id="shorts-target-${section}">${options(target, "No target")}</select>
      <details class="shorts-running-fields"${entry.active && max ? " open" : ""}>
        <summary>Campaign already running</summary>
        <label class="checkbox-row"><input id="shorts-running-${section}" type="checkbox"${entry.active && completed < target ? " checked" : ""}> The next campaign is already running</label>
        <label class="field-label" for="shorts-hours-${section}">Time remaining</label>
        <input id="shorts-hours-${section}" class="time-remaining-input" type="text" placeholder="00:00:00" pattern="${DURATION_PATTERN}" title="Hours:minutes:seconds (e.g. 02:30:00)" autocomplete="off" spellcheck="false">
        <div class="shorts-worker-grid">${TYPE_ORDER.map((type, index) => `<div>
          <label class="field-label" for="shorts-active-${section}-${index}">${type}</label>
          <input id="shorts-active-${section}-${index}" type="number" min="0" step="1" value="0">
        </div>`).join("")}</div>
      </details>
    </fieldset>`;
  }).join("");
  CAMPAIGN_SECTIONS.forEach(section => {
    const active = progress[section].active;
    if (active) {
      byId(`shorts-hours-${section}`).value = formatRemainingTime(Number(active.remainingHours));
      TYPE_ORDER.forEach((type, index) => { byId(`shorts-active-${section}-${index}`).value = active.workers[type]; });
    }
    byId(`shorts-completed-${section}`).addEventListener("change", () => {
      const completed = Number(byId(`shorts-completed-${section}`).value);
      const target = byId(`shorts-target-${section}`);
      if (Number(target.value) < completed) target.value = String(completed);
      byId(`shorts-running-${section}`).checked = false;
      renderFarmMissions();
      renderCampaignFarmMissions();
      scheduleSave();
    });
    byId(`shorts-target-${section}`).addEventListener("change", () => { renderCampaignFarmMissions(); scheduleSave(); });
  });
}

// Build mission selection tiles grouped by tier.
function createMissionTierMarkup(names, selected, inputClass, showUnlocks = false, unlocked = []) {
  const tiers = { F1: [], F2: [], F3: [], F4: [] };
  names.forEach(name => tiers[name.split("-")[0]]?.push(name));
  return Object.entries(tiers).filter(([, tierNames]) => tierNames.length).map(([tier, tierNames]) => {
    const selectedCount = tierNames.filter(name => selected.has(name)).length;
    const tiles = tierNames.map(name => `
      <label class="mission-tile ${selected.has(name) ? "is-checked" : ""}">
        <input class="mission-tile-input ${inputClass}" type="checkbox" value="${name}" ${selected.has(name) ? "checked" : ""} />
        <span>${name}${showUnlocks ? `<small class="farm-unlock-label">${unlocked.includes(name) ? "Available now" : `After ${farmUnlockCampaign(name)}`}</small>` : ""}</span>
      </label>`).join("");
    return `<div class="mission-tier-card">
      <div class="mission-tier-header"><h3>${tier}</h3><span class="mission-tier-count">${selectedCount} selected</span></div>
      <div class="mission-tile-grid">${tiles}</div>
    </div>`;
  }).join("");
}

// Refresh the farm choices and handle selection changes.
function getCampaignFarmNames(useTargets = false) {
  const progress = byId("campaignEnabled").checked && byId("shortsEnabled").checked ? readShortsProgress() : null;
  return getVisibleFarmNames(byId("ouroToggle").checked, progress, useTargets);
}

function renderFarmMissions() {
  const visible = getVisibleFarmNames(byId("ouroToggle").checked);
  const container = byId("farmMissionSelectionGrid");
  container.innerHTML = createMissionTierMarkup(visible, selectedFarmMissions, "farm-mission-input") ||
    '<div class="mission-tier-empty">No farms are unlocked yet. Complete campaign 1 in a section to unlock its first farm.</div>';
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

// Refresh the farms allowed to run alongside the campaign.
function renderCampaignFarmMissions() {
  const container = byId("campaignFarmMissionSelectionGrid");
  if (!byId("campaignEnabled").checked) {
    container.replaceChildren();
    byId("futureFarmSelection").classList.add("hidden");
    return;
  }
  const unlocked = getCampaignFarmNames();
  const shorts = byId("shortsEnabled").checked;
  container.classList.toggle("hidden", shorts);
  container.innerHTML = createMissionTierMarkup(unlocked, selectedCampaignFarmMissions, "campaign-farm-input");
  container.querySelectorAll(".campaign-farm-input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) selectedCampaignFarmMissions.add(input.value);
      else selectedCampaignFarmMissions.delete(input.value);
      renderCampaignFarmMissions();
      scheduleSave();
    });
  });
  byId("futureFarmSelection").classList.toggle("hidden", !shorts);
  const futureContainer = byId("futureFarmMissionSelectionGrid");
  futureContainer.innerHTML = createMissionTierMarkup(getVisibleFarmNames(byId("ouroToggle").checked), selectedCampaignFarmMissions, "future-farm-input", true, unlocked);
  futureContainer.querySelectorAll(".future-farm-input").forEach(input => {
    input.addEventListener("change", () => {
      if (input.checked) selectedCampaignFarmMissions.add(input.value);
      else selectedCampaignFarmMissions.delete(input.value);
      renderCampaignFarmMissions();
      scheduleSave();
    });
  });
}

// Show settings that apply to the current mode and unlocks.
function syncConditionalVisibility() {
  const ouro = byId("ouroToggle").checked;
  const campaign = byId("campaignEnabled").checked;
  const hybrid = byId("modeSelect").value === "Fragments + Resources";
  const shorts = byId("shortsEnabled").checked;
  byId("plannerModeLabel").textContent = ouro ? "Shorts Mode" : "Campaign Planner";
  byId("plannerModeHelp").textContent = ouro ? "Plan and track campaigns across C1–C4." : "Plan and track C1–C3 campaigns 1–8.";
  document.querySelectorAll(".ouro-only, .campaign-enabled-only, .hybrid-mode-only, .shorts-only, .single-campaign-only").forEach(element => {
    const visible = (!element.classList.contains("ouro-only") || ouro) &&
      (!element.classList.contains("campaign-enabled-only") || campaign) &&
      (!element.classList.contains("hybrid-mode-only") || hybrid) &&
      (!element.classList.contains("shorts-only") || shorts) &&
      (!element.classList.contains("single-campaign-only") || !shorts);
    element.classList.toggle("hidden", !visible);
    if (element.matches("section, div.field-card")) element.setAttribute("aria-hidden", String(!visible));
  });
  byId("hybridWeightControl").setAttribute("aria-hidden", String(!(ouro && hybrid)));
  renderFarmMissions();
  renderCampaignFarmMissions();
}

// Update the fragment and resource percentages beside the slider.
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

// Collect the current settings from the page.
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
    selectedCampaignFarmMissions: [...selectedCampaignFarmMissions],
    mode: byId("modeSelect").value,
    searchEffort: byId("searchEffort").checked ? "crazy" : "standard",
    hybridFragmentPercent: byId("hybridFragmentPercent").value,
    fragmentsPerCompletion: byId("baseFragmentsInput").value,
    campaignEnabled: byId("campaignEnabled").checked,
    campaignTargetName: byId("campaignTarget").value,
    shortsEnabled: byId("shortsEnabled").checked,
    shortsProgress: readShortsProgress(),
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

// Fill the page with loaded or default settings.
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
  byId("shortsEnabled").checked = input.shortsEnabled;
  renderShortsControls(input.shortsProgress);
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

// Remove the previous input errors.
function clearValidation() {
  document.querySelectorAll("[aria-invalid='true']").forEach(element => {
    element.removeAttribute("aria-invalid");
    element.removeAttribute("aria-describedby");
  });
  document.querySelectorAll(".input-error").forEach(element => element.remove());
  byId("validationSummary").classList.add("hidden");
  byId("validationList").replaceChildren();
}

// Show input errors beside their fields and in the summary.
function showValidation(errors) {
  clearValidation();
  const seen = new Set();
  errors.forEach(error => {
    const id = fieldId(error.field);
    if (seen.has(`${id}:${error.message}`)) return;
    seen.add(`${id}:${error.message}`);
    const control = byId(id);
    if (control) {
      control.closest("details")?.setAttribute("open", "");
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

// Wait briefly before saving so typing does not trigger repeated saves.
function scheduleSave() {
  updateShortsStaleness();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistCurrentIfValid, 180);
}

// Save the current settings only when they pass the input checks.
function persistCurrentIfValid() {
  const { input, errors } = validateInput(readFormInput());
  if (!errors.length) persistInput(input);
}

// Save settings and show a notice if browser storage fails.
function persistInput(input) {
  try {
    saveState(input);
    return true;
  } catch {
    showNotice("This browser could not save your settings locally.");
    return false;
  }
}

// Show or hide the settings notice.
function showNotice(message) {
  byId("stateNotice").textContent = message;
  byId("stateNotice").classList.toggle("hidden", !message);
}

// Update the buttons and progress panel while a search runs.
function setRunning(running) {
  byId("runOptimizerBtn").disabled = running;
  byId("floatingOptimizerBtn").disabled = running;
  byId("floatingOptimizerBtn").textContent = byId("runOptimizerBtn").textContent;
  byId("resetInputsBtn").disabled = running;
  byId("cancelOptimizerBtn").classList.toggle("hidden", !running);
  byId("runProgressPanel").classList.toggle("hidden", !running);
  byId("shortsRecalculateBtn").disabled = running;
  document.querySelectorAll("[data-shorts-resume]").forEach(button => { button.disabled = running || byId("shortsStale").classList.contains("hidden") === false; });
  renderTracker();
}

// Update the short status message.
function setStatus(text) {
  byId("statusText").textContent = text;
}

// Refresh the progress bar, elapsed time, and search details.
function renderProgress(updateStatus = false) {
  if (!latestProgress || progressStartedAt == null) return;
  const view = buildProgressView(latestProgress);
  const phaseElement = byId("runProgressPhase");
  if (phaseElement.textContent !== view.phaseLabel) phaseElement.textContent = view.phaseLabel;
  if (updateStatus) setStatus(view.phaseLabel);

  byId("runProgressElapsed").textContent = `Elapsed ${formatDuration(performance.now() - progressStartedAt)}`;
  const progressElement = byId("optimizerProgress");
  if (view.determinate) {
    progressElement.max = view.total;
    progressElement.value = view.completed;
    const percent = Math.round(view.completed / view.total * 100);
    progressElement.textContent = `${percent}%`;
    progressElement.setAttribute("aria-valuetext", `${percent}% of current phase`);
  } else {
    progressElement.removeAttribute("value");
    progressElement.textContent = "In progress";
    progressElement.setAttribute("aria-valuetext", "Working; completion time is unknown");
  }

  const telemetry = [];
  const solverWork = formatSolverWork(latestProgress);
  if (solverWork) telemetry.push(solverWork);
  if (view.gapText != null) telemetry.push(`Optimality gap (current step) ${view.gapText}`);
  if (!solverWork && view.nodeText != null) telemetry.push(`Nodes searched ${view.nodeText}`);
  if (telemetry.length === 0 && view.determinate) {
    telemetry.push(`${Math.round(view.completed / view.total * 100)}% of current phase`);
  }
  byId("runProgressTelemetry").textContent = telemetry.join(" · ") || view.phaseLabel;
  const activity = byId("runProgressActivity");
  activity.hidden = !latestProgress.solverSearch;
  activity.textContent = formatSolverUpdateAge(lastSolverUpdateAt == null ? null : performance.now() - lastSolverUpdateAt);
}

// Store the latest progress and display it.
function updateProgress(progress) {
  if (Number.isFinite(progress.solverUpdate) && progress.solverUpdate > lastSolverUpdate) {
    lastSolverUpdate = progress.solverUpdate;
    lastSolverUpdateAt = performance.now();
  }
  latestProgress = { ...progress };
  renderProgress(true);
}

// Stop the progress timer and restore the idle controls.
function stopProgress() {
  if (progressTimer != null) window.clearInterval(progressTimer);
  progressTimer = null;
  progressStartedAt = null;
  latestProgress = null;
  lastSolverUpdateAt = null;
  lastSolverUpdate = 0;
  setRunning(false);
}

// Prepare the progress display for a new run.
function startProgress() {
  stopProgress();
  progressStartedAt = performance.now();
  setRunning(true);
  updateProgress({ phase: "preparing", determinate: true, completed: 0, total: 1 });
  progressTimer = window.setInterval(() => renderProgress(false), 250);
}

// Check inputs, start the search, and display its result or error.
async function runOptimizer() {
  if (workerClient.isRunning) return;
  stopProgress();
  clearValidation();
  showNotice("");
  let trackingRequest = null;
  const inputReadAt = Date.now();
  const raw = readFormInput();
  try {
    if (tracker) trackingRequest = { ...prepareTrackerUpdate(tracker, raw, inputReadAt), epoch: trackerEpoch, formKey: trackerSettingsKey(raw) };
  } catch (error) {
    if (error.errors) showValidation(error.errors);
    showNotice(error.message);
    return;
  }
  const { input, errors } = validateInput(trackingRequest?.input || raw);
  if (errors.length) {
    showValidation(errors);
    setStatus("Check inputs");
    return;
  }
  persistInput(input);
  try {
    startProgress();
    const result = await workerClient.run(input, { onProgress: updateProgress, reservedFarms: trackingRequest?.reservedFarms || [] });
    if (suppressNextCancellationStatus) {
      suppressNextCancellationStatus = false;
      stopProgress();
      return;
    }
    stopProgress();
    if (trackingRequest) {
      if (!tracker || trackerEpoch !== trackingRequest.epoch || tracker.revision !== trackingRequest.revision || trackerSettingsKey(readFormInput()) !== trackingRequest.formKey) throw new Error("Tracking or settings changed during the update. Your current tracker has been kept; update again when ready.");
      tracker = mergeTrackerUpdate(tracker, result, input, trackingRequest.startedAt);
      trackerEpoch++;
      storeTracker();
      syncTrackerForm(false);
      renderResult(result, tracker.input, tracker.plannedAt);
    } else {
      // Imported timers were read before the search. Search time must not extend them.
      const hasRunningMissions = result.shortsPlan?.jobs.some(job => job.alreadyRunning);
      renderResult(result, input, hasRunningMissions ? inputReadAt : Date.now());
    }
    const completionStatus = result.solutionStatus === "cancelled-best" ? "Cancelled — best found"
      : result.shortsPlan ? (result.shortsPlan.status === "blocked" ? "Plan blocked" : "Plan complete.")
      : result.searchEffort === "crazy" && result.solutionStatus === "best-found" ? "Best found — target not verified"
      : result.searchEffort === "crazy" ? "Completed — accuracy target met" : "Completed";
    setStatus(completionStatus);
    byId("output").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    stopProgress();
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

// Stop the active search and keep any complete result already found.
function cancelOptimizer() {
  if (!workerClient.isRunning) return;
  setStatus("Cancelling…");
  updateProgress({ ...(latestProgress || {}), phase: "cancelling", determinate: false });
  workerClient.cancel();
}

// Format a number for display, or show a dash when unavailable.
function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

// Shorten consecutive mission names into readable ranges.
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
    // Add the current mission or range to the display list.
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

function formatRouteTime(hours) {
  if (!Number.isFinite(hours)) return "Blocked";
  return formatDuration(Math.ceil(hours * 3600) * 1000);
}

function updateShortsStaleness() {
  if (!shortsInputSnapshot) return;
  const stale = tracker ? trackerSettingsChanged() : canonicalStringify(validateInput(readFormInput()).input) !== shortsInputSnapshot;
  byId("shortsStale").classList.toggle("hidden", !stale);
  document.querySelectorAll("[data-shorts-resume]").forEach(button => { button.disabled = Boolean(tracker) || stale || workerClient.isRunning; });
  renderTracker();
}

function renderShortsResult(result, input, startedAt) {
  const plan = result.shortsPlan;
  byId("shortsOutput").classList.toggle("hidden", !plan);
  shortsInputSnapshot = plan ? canonicalStringify(input) : null;
  if (!plan) return;
  byId("shortsOutputTitle").textContent = input.ouroUnlocked ? "Shorts campaign plan" : "Campaign plan";
  byId("shortsContinueHelp").classList.toggle("hidden", Boolean(tracker));
  byId("trackerStepsHelp").classList.toggle("hidden", !tracker);
  byId("shortsClockExplanation").textContent = tracker ? "Use the live timers for current finish times." : `Start at ${formatLocalETA(startedAt, 0)} to follow these estimated times.`;
  byId("shortsSummary").textContent = plan.status === "blocked"
    ? `Route cannot finish all targets. Awaiting personnel: ${plan.unresolved.join(", ") || "remaining campaigns"}.`
    : `${plan.jobs.length} campaign${plan.jobs.length === 1 ? "" : "s"} ${tracker ? "in the last plan · Estimated total" : "remaining · All targets complete in"} ${formatRouteTime(plan.totalHours)}. ${tracker ? "Estimated finish" : "ETA"}: ${formatLocalETA(startedAt, plan.totalHours)}.`;
  byId("shortsVerification").textContent = plan.status === "blocked" ? "Add workers or select fewer farms." : "Plan complete.";
  byId("shortsSteps").replaceChildren();
  plan.steps.forEach((step, index) => {
    if (!plan.jobs.length) return;
    const item = document.createElement("li");
    item.className = "shorts-step";
    const title = document.createElement("h4");
    const finishedNames = new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(step.completed);
    title.textContent = index === 0 ? "Start now" : `After ${finishedNames} ${step.completed.length === 1 ? "has" : "have"} finished`;
    item.append(title);
    const localTime = document.createElement("p");
    localTime.className = "tiny-note";
    localTime.append(document.createTextNode("Local time: "), createETA(startedAt, step.timeHours));
    item.append(localTime);
    (step.farmStarts || []).forEach(farm => {
      const card = document.createElement("div");
      card.className = "shorts-launch shorts-farm-start";
      const label = document.createElement("strong");
      label.textContent = `Start farming ${farm.name}`;
      const workers = TYPE_ORDER.filter(type => farm.workers[type] > 0).map(type => `${formatNumber(farm.workers[type], 0)} ${type}${farm.workers[type] === 1 ? "" : "s"}`).join(" · ");
      card.append(label, document.createElement("br"), document.createTextNode(workers), document.createElement("br"), document.createTextNode(`Unlocked by ${farm.unlockCampaign}. Keep these workers assigned to this farm.`));
      item.append(card);
    });
    step.launches.forEach(job => {
      const launch = document.createElement("div");
      launch.className = "shorts-launch";
      const label = document.createElement("strong");
      label.textContent = `Run ${job.name}`;
      const workers = TYPE_ORDER.filter(type => job.workers[type] > 0).map(type => `${formatNumber(job.workers[type], 0)} ${type}${job.workers[type] === 1 ? "" : "s"}`).join(" · ");
      launch.append(label, document.createElement("br"), document.createTextNode(workers), document.createElement("br"), document.createTextNode(`Duration: ${formatRouteTime(job.endHours - job.startHours)} · Finishes ${formatRouteTime(job.endHours)} after the plan starts`));
      launch.append(document.createElement("br"), document.createTextNode("ETA: "), createETA(startedAt, job.endHours));
      item.append(launch);
    });
    const continuing = step.running.filter(job => job.startHours < step.timeHours || job.alreadyRunning);
    if (continuing.length) {
      const keep = document.createElement("ul");
      keep.className = "tiny-note shorts-continuing";
      continuing.forEach(job => {
        const line = document.createElement("li");
        line.textContent = `Keep ${job.name} running — ${formatRouteTime(job.endHours - step.timeHours)} remaining.`;
        line.append(document.createTextNode(" ETA: "), createETA(startedAt, job.endHours));
        keep.append(line);
      });
      item.append(keep);
    }
    if (index > 0 && !tracker) {
      const resume = document.createElement("button");
      resume.type = "button";
      resume.className = "action-button";
      resume.dataset.shortsResume = String(index);
      resume.textContent = "Continue from here";
      resume.setAttribute("aria-label", `Update progress after ${step.completed.join(" and ")}, before new launches`);
      resume.addEventListener("click", () => {
        renderShortsControls(progressAtShortsStep(result.shortsProgress, plan, step.timeHours));
        renderFarmMissions();
        renderCampaignFarmMissions();
        scheduleSave();
        persistCurrentIfValid();
        showNotice(`Progress updated to +${formatRouteTime(step.timeHours)}, before this step’s new launches. Check running timers against the game, update total personnel or modifiers, then recalculate.`);
        byId("campaign").scrollIntoView({ behavior: "smooth", block: "start" });
        byId("shorts-completed-C1").focus({ preventScroll: true });
      });
      item.append(resume);
    }
    if (plan.steps[index + 1]) {
      const wait = document.createElement("p");
      wait.className = "tiny-note";
      wait.textContent = `Wait ${formatRouteTime(plan.steps[index + 1].timeHours - step.timeHours)} for the next completion.`;
      item.append(wait);
    } else if (plan.status !== "blocked") {
      const done = document.createElement("p");
      done.textContent = "All selected targets are complete.";
      item.append(done);
    }
    byId("shortsSteps").append(item);
  });
  updateShortsStaleness();
}

// Render a local finish date with a machine-readable timestamp.
function createETA(startedAt, hours) {
  const element = document.createElement("time");
  const timestamp = etaTimestamp(startedAt, hours);
  if (timestamp != null) element.dateTime = new Date(timestamp).toISOString();
  element.textContent = formatLocalETA(startedAt, hours);
  return element;
}

// Fill the output tables with allocations, rewards, and remaining personnel.
function renderResult(result, input, startedAt = Date.now()) {
  trackingPreview = result.shortsPlan?.status === "best-found" && result.shortsPlan.jobs.length ? { result, input: structuredClone(input), startedAt } : null;
  renderShortsResult(result, input, startedAt);
  byId("distributionTitle").textContent = result.shortsPlan ? (tracker ? "Farm allocations — confirm new farms in the tracker" : "Farm allocation — keep these workers assigned") : "Mission Distribution";
  byId("unassignedTitle").textContent = result.shortsPlan ? "Unassigned Personnel — at plan start" : "Unassigned Personnel";
  byId("totalsTitle").textContent = result.shortsPlan ? "Initial farm output per hour (before material bonuses)" : "Farm output per hour (before material bonuses)";
  byId("campaignEtaText").textContent = formatNumber(result.campaignETA);
  byId("campaignEtaClockText").replaceChildren(input.campaignEnabled ? createETA(startedAt, result.campaignETA) : document.createTextNode("—"));
  byId("modeUsedText").textContent = result.modeUsed;
  byId("elapsedText").textContent = formatDuration(result.durationMs);
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
    if (result.shortsPlan && !assignment.name.startsWith("F")) return;
    if (!rows.has(assignment.name)) rows.set(assignment.name, Object.fromEntries(TYPE_ORDER.map(type => [type, 0])));
    rows.get(assignment.name)[assignment.type] = assignment.count;
  });
  byId("distributionBody").innerHTML = rows.size ? Array.from(rows, ([name, counts]) => `
    <tr><td>${name}</td>${TYPE_ORDER.map(type => `<td data-label="${type}">${counts[type] ? formatNumber(counts[type], 0) : '<span class="zero-cell">-</span>'}</td>`).join("")}</tr>`).join("") :
    `<tr><td colspan="5">${result.shortsPlan ? "No workers are assigned to farms. Available workers can be used for campaigns." : "No assignments were generated. Review the notices and selected missions above."}</td></tr>`;

  const resourceRows = [...MATS.map(material => [material, result.totals[material] || 0]), ["Academy Pts", result.totals.Academy || 0]];
  const totalRows = [["Completions", result.totals.Completions || 0], ["Fragments (est.)", result.totals.Fragments || 0]];
  const renderTotals = rows => rows.map(([label, value]) => `<tr><td>${label}</td><td data-label="Value">${formatNumber(value)}</td></tr>`).join("");
  byId("totalsBody").innerHTML = renderTotals(totalRows);
  byId("resourceTotalsBody").innerHTML = renderTotals(resourceRows);
  byId("unassignedBody").innerHTML = TYPE_ORDER.map(type => `<tr><td>${type}</td><td data-label="Remaining">${formatNumber(result.unassignedWorkers[type] || 0, 0)}</td></tr>`).join("");
}

// Clear the result tables and return the status to Ready.
function clearOutput() {
  byId("shortsStepsDisclosure").open = false;
  trackingPreview = null;
  shortsInputSnapshot = null;
  byId("shortsOutput").classList.add("hidden");
  byId("distributionTitle").textContent = "Mission Distribution";
  byId("unassignedTitle").textContent = "Unassigned Personnel";
  byId("totalsTitle").textContent = "Farm output per hour (before material bonuses)";
  byId("resourceTotalsDisclosure").open = false;
  stopProgress();
  ["campaignEtaText", "campaignEtaClockText", "modeUsedText", "elapsedText", "selectedFarmCountText", "selectedFarmNamesText"].forEach(id => { byId(id).textContent = "—"; });
  byId("distributionBody").innerHTML = '<tr><td colspan="5">Run the optimizer to populate mission distribution.</td></tr>';
  byId("totalsBody").innerHTML = '<tr><td colspan="2">Run the optimizer to populate totals.</td></tr>';
  byId("resourceTotalsBody").innerHTML = '<tr><td colspan="2">Run the optimizer to populate resources.</td></tr>';
  byId("unassignedBody").innerHTML = '<tr><td colspan="2">Run the optimizer to show remaining personnel.</td></tr>';
  byId("resultNotices").replaceChildren();
  byId("resultNotices").classList.add("hidden");
  setStatus("Ready");
  renderTracker();
}

// Confirm the reset, clear saved settings, and restore defaults.
function resetInputs() {
  const current = validateInput(readFormInput()).input;
  const defaults = createDefaultInput();
  if ((tracker || canonicalStringify(current) !== canonicalStringify(defaults)) && !window.confirm("Reset all optimiser inputs and clear saved settings and mission tracking?")) return;
  if (workerClient.isRunning) suppressNextCancellationStatus = true;
  cancelOptimizer();
  let resetWarning = "";
  try { clearState(); } catch { resetWarning = "Saved settings could not be cleared in this browser."; }
  try { clearTracker(); } catch { resetWarning = "Saved tracking could not be cleared in this browser."; }
  tracker = null;
  trackerEpoch++;
  clearValidation();
  applyInput(defaults);
  clearOutput();
  showNotice(resetWarning);
}

// Connect the select-all and clear-all mission buttons.
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
    const names = byId("shortsEnabled").checked ? getVisibleFarmNames(byId("ouroToggle").checked) : getCampaignFarmNames();
    names.forEach(name => selectedCampaignFarmMissions.add(name));
    renderCampaignFarmMissions(); scheduleSave();
  });
  byId("campaignFarmClearAllBtn").addEventListener("click", () => {
    const names = byId("shortsEnabled").checked ? getVisibleFarmNames(byId("ouroToggle").checked) : getCampaignFarmNames();
    names.forEach(name => selectedCampaignFarmMissions.delete(name));
    renderCampaignFarmMissions(); scheduleSave();
  });
}

// Connect settings changes and the run, cancel, and reset buttons.
function initialiseForm() {
  byId("ouroToggle").addEventListener("change", () => {
    const shortsProgress = readShortsProgress();
    const mode = byId("modeSelect").value;
    const target = byId("campaignTarget").value;
    renderModeOptions(mode);
    renderCampaignTargets(target);
    renderShortsControls(shortsProgress);
    renderFarmMissions();
    syncConditionalVisibility();
    scheduleSave();
    if (!tracker) clearOutput();
  });
  byId("campaignEnabled").addEventListener("change", () => { syncConditionalVisibility(); scheduleSave(); });
  byId("shortsEnabled").addEventListener("change", () => { syncConditionalVisibility(); scheduleSave(); });
  byId("shortsRecalculateBtn").addEventListener("click", runOptimizer);
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
      if (/^shorts-(completed|running|hours|active)-/.test(event.target.id) || ["campaignEnabled", "shortsEnabled", "ouroToggle"].includes(event.target.id)) stopTrackingForNewPlan();
      updateShortsStaleness();
      window.clearTimeout(saveTimer);
      persistCurrentIfValid();
    }
  });
  window.addEventListener("pagehide", persistCurrentIfValid);
}

function trackerSettingsChanged() {
  return Boolean(tracker && trackerSettingsKey(readFormInput()) !== trackerSettingsKey(tracker.input));
}

function renderTracker() {
  trackerView?.render(tracker, {
    busy: workerClient.isRunning || progressStartedAt != null,
    settingsChanged: tracker ? trackerSettingsChanged() : Boolean(trackingPreview && canonicalStringify(validateInput(readFormInput()).input) !== canonicalStringify(trackingPreview.input)),
    previewAvailable: Boolean(trackingPreview)
  });
}

function storeTracker() {
  try { saveTracker(tracker); }
  catch { showNotice("Tracking is active, but this browser could not save it. Keep this page open to retain your timers."); }
}

function stopTrackingForNewPlan(resetProgress = false) {
  if (!tracker) return;
  if (workerClient.isRunning) {
    suppressNextCancellationStatus = true;
    cancelOptimizer();
  }
  tracker = null;
  trackerEpoch++;
  let warning = "";
  try { clearTracker(); } catch { warning = " The saved tracker could not be cleared in this browser."; }
  if (resetProgress) {
    const progress = readShortsProgress();
    CAMPAIGN_SECTIONS.forEach(key => { progress[key].completed = 0; progress[key].active = null; });
    renderShortsControls(progress);
    renderFarmMissions();
    renderCampaignFarmMissions();
  }
  clearOutput();
  persistCurrentIfValid();
  showNotice((resetProgress
    ? "Fresh plan ready from the first campaign in each section. Personnel, modifiers, targets and farm selections have been kept."
    : "Live tracking stopped. Run Optimizer to create a new plan using your edited campaign progress.") + warning);
  if (resetProgress) {
    byId("campaign").scrollIntoView({ block: "start" });
    byId("shorts-completed-C1").focus({ preventScroll: true });
  }
}

function syncTrackerForm(preserveTargets = true) {
  const progress = trackerProgress(tracker);
  if (preserveTargets) CAMPAIGN_SECTIONS.forEach(key => {
    progress[key].target = Math.max(progress[key].completed + (progress[key].active ? 1 : 0), Number(byId(`shorts-target-${key}`).value));
  });
  byId("campaignEnabled").checked = true;
  byId("shortsEnabled").checked = true;
  renderShortsControls(progress);
  syncConditionalVisibility();
  renderFarmMissions();
  renderCampaignFarmMissions();
  persistCurrentIfValid();
}

function trackerAction(action) {
  if (!tracker || workerClient.isRunning) return;
  try {
    if (["start", "farm"].includes(action.type) && trackerSettingsChanged()) throw new Error("Update the remaining plan to apply changed settings first.");
    tracker = transitionTracker(tracker, action);
    trackerEpoch++;
    storeTracker();
    syncTrackerForm();
    updateShortsStaleness();
    trackerView.focus();
  } catch (error) { showNotice(error.message); }
}

function startTracking() {
  if (!trackingPreview || tracker || workerClient.isRunning) return;
  if (canonicalStringify(validateInput(readFormInput()).input) !== canonicalStringify(trackingPreview.input)) return;
  tracker = createTracker(trackingPreview.result, trackingPreview.input, trackingPreview.startedAt);
  trackerEpoch++;
  notificationFailure = false;
  storeTracker();
  syncTrackerForm(false);
  renderResult(tracker.result, tracker.input, tracker.plannedAt);
  trackerView.focus();
}

async function toggleTrackerNotifications() {
  if (!tracker || workerClient.isRunning || typeof Notification === "undefined") return;
  const current = tracker;
  try {
    if (tracker.notificationsEnabled && Notification.permission === "granted") {
      trackerAction({ type: "notifications", enabled: false });
      return;
    }
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (tracker !== current) return;
    if (permission === "granted") {
      notificationFailure = false;
      trackerAction({ type: "notifications", enabled: true });
      tickTracker();
    } else {
      showNotice(permission === "denied" ? "Notifications are blocked. Allow notifications in your browser’s site settings to enable them." : "Notifications were not enabled. You can choose Notify me again later.");
      renderTracker();
    }
  } catch { showNotice("This browser could not enable notifications. Your mission timers will continue on this page."); }
}

function tickTracker() {
  trackerView?.tick();
  if (!tracker || notificationFailure || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  let changed = false;
  for (const job of pendingNotifications(tracker)) {
    try {
      const alert = new Notification(`${job.name} is ready to confirm`, {
        body: "Check that the campaign has finished in-game, then confirm it in your mission tracker. Its workers remain reserved.",
        tag: `cifi-${job.name}-${job.endsAt}`, silent: true
      });
      alert.onclick = () => {
        window.focus();
        setTab(document.querySelector('[role="tab"][data-tab="optimizer"]'));
        byId("shortsTracker").scrollIntoView({ block: "center" });
        trackerView.focus();
        alert.close();
      };
      job.notifiedFor = job.endsAt;
      changed = true;
    } catch {
      notificationFailure = true;
      showNotice("This browser could not display a campaign notification. Check the live tracker for finished timers.");
      break;
    }
  }
  if (changed) storeTracker();
}

function finishTracking() {
  if (!tracker || workerClient.isRunning || !trackerActions(tracker).complete) return;
  syncTrackerForm();
  try { clearTracker(); } catch { showNotice("The saved tracker could not be cleared in this browser."); }
  tracker = null;
  trackerEpoch++;
  clearOutput();
}

// Set up the page and restore saved settings.
function initialise() {
  initialiseTabs();
  initialiseSectionJumps();
  initialiseSelectionButtons();
  initialiseForm();
  initialiseFloatingOptimizer();
  const loaded = loadState();
  applyInput(loaded.input);
  trackerView = createTrackerView(byId("shortsTracker"), {
    onAction: trackerAction, onTrack: startTracking, onUpdate: runOptimizer,
    onFinish: finishTracking, onNotify: toggleTrackerNotifications,
    onFreshPlan: () => stopTrackingForNewPlan(true)
  });
  clearOutput();
  const restored = loadTracker();
  if (restored.state) {
    tracker = restored.state;
    syncTrackerForm(false);
    renderResult(tracker.result, tracker.input, tracker.plannedAt);
  }
  showNotice([loaded.warning, restored.warning].filter(Boolean).join(" "));
  window.setInterval(tickTracker, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tickTracker(); });
  window.addEventListener("focus", tickTracker);
  window.addEventListener("storage", event => {
    if (event.key !== TRACKER_STORAGE_KEY && event.key !== null) return;
    const restored = loadTracker();
    tracker = restored.state;
    trackerEpoch++;
    if (tracker) {
      syncTrackerForm(false);
      renderResult(tracker.result, tracker.input, tracker.plannedAt);
    } else clearOutput();
    if (restored.warning) showNotice(restored.warning);
  });
  tickTracker();
  document.documentElement.dataset.appVersion = APP_VERSION;
}

initialise();
