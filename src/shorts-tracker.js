import { ALL_CAMPAIGN_MISSIONS, ALL_FARM_MISSIONS, MISSION_DATA, TYPE_ORDER, farmUnlockCampaign } from "./data.js?v=3.2.7";
import { CAMPAIGN_SECTIONS, calculateGlobalSpeedMultiplier, validateInput } from "./validation.js?v=3.2.7";
import { SECTION_REQUIREMENTS } from "./campaign-unlocks.js?v=3.2.7";
import { checkFarmReservationHorizon, createFarmReservations } from "./farm-reservations.js?v=3.2.7";
import { canonicalStringify } from "./random.js?v=3.2.7";

export const TRACKER_STORAGE_KEY = "cifi-shorts-tracker-v1";
const crew = value => Object.fromEntries(TYPE_ORDER.map(type => [type, value?.[type] || 0]));
const stage = name => Number(name.split("-")[1]);
const section = name => name.split("-")[0];
const sameCrew = (a, b) => TYPE_ORDER.every(type => a[type] === b[type]);
const validCrew = value => value && Object.keys(value).every(type => TYPE_ORDER.includes(type)) && TYPE_ORDER.every(type => Number.isSafeInteger(value[type]) && value[type] >= 0) && Object.values(value).reduce((a, b) => a + b, 0) > 0;
const validDate = value => Number.isFinite(value) && Math.abs(value) <= 8.64e15;
const withinCap = (name, workers, cap = MISSION_DATA.find(row => row.name === name)?.cap) => Number.isSafeInteger(cap) && cap > 0 && validCrew(workers) && Object.values(workers).reduce((a, b) => a + b, 0) <= cap;

function missionFromJob(job, plannedAt) {
  return {
    name: job.name, section: job.section, workers: crew(job.workers), cap: job.cap,
    durationMs: Math.ceil(((job.finishHours ?? job.endHours) - job.startHours) * 3600000),
    plannedStartHours: job.startHours, plannedEndHours: job.endHours,
    status: job.alreadyRunning ? "running" : "queued", imported: Boolean(job.alreadyRunning),
    startedAt: null, endsAt: job.alreadyRunning ? plannedAt + Math.ceil((job.finishHours ?? job.endHours) * 3600000) : null,
    completedAt: null, notifiedFor: null
  };
}

export function farmRows(farms) {
  return farms.flatMap(farm => TYPE_ORDER.filter(type => farm.workers[type] > 0).map(type => ({ name: farm.name, type, count: farm.workers[type] })));
}

function farmsFromResult(result, reserveInitial) {
  const farms = {};
  result.assignments.filter(row => row.name.startsWith("F")).forEach(row => {
    farms[row.name] ??= { name: row.name, workers: crew(), status: reserveInitial ? "reserved" : "pending", unlockCampaign: farmUnlockCampaign(row.name) };
    farms[row.name].workers[row.type] += row.count;
  });
  result.shortsPlan.farmEvents.forEach(farm => { farms[farm.name] = { name: farm.name, workers: crew(farm.workers), status: "pending", unlockCampaign: farm.unlockCampaign }; });
  return farms;
}

export function createTracker(result, input, now = Date.now()) {
  if (result.shortsPlan?.status !== "best-found" || !Number.isFinite(result.shortsPlan.totalHours)) throw new Error("A complete, feasible Shorts plan is needed before tracking.");
  const progress = result.shortsProgress;
  return {
    schemaVersion: 1, revision: 0, savedAt: now, plannedAt: now,
    input: structuredClone({ ...input, shortsProgress: progress }), result: structuredClone(result),
    completed: Object.fromEntries(CAMPAIGN_SECTIONS.map(key => [key, progress[key].completed])),
    targets: Object.fromEntries(CAMPAIGN_SECTIONS.map(key => [key, progress[key].target])),
    missions: Object.fromEntries(result.shortsPlan.jobs.map(job => [job.name, missionFromJob(job, now)])),
    farms: farmsFromResult(result, true), needsUpdate: false, notificationsEnabled: false
  };
}

export function trackerSettingsKey(raw) {
  const input = validateInput(raw).input;
  // Completion and running fields are owned by the tracker, not editable settings.
  input.shortsProgress = Object.fromEntries(CAMPAIGN_SECTIONS.map(key => [key, { target: input.shortsProgress[key].target }]));
  return canonicalStringify(input);
}

export function trackerFreeWorkers(state) {
  const free = Object.fromEntries(TYPE_ORDER.map(type => [type, state.input.workers[type].count]));
  const busy = [...Object.values(state.missions).filter(job => job.status === "running"), ...Object.values(state.farms).filter(farm => farm.status === "reserved")];
  busy.forEach(item => TYPE_ORDER.forEach(type => { free[type] -= item.workers[type]; }));
  return free;
}

export function dueMissions(state, now = Date.now()) {
  return Object.values(state.missions).filter(job => job.status === "running" && job.endsAt <= now).sort((a, b) => a.endsAt - b.endsAt || a.name.localeCompare(b.name));
}

export function dueFarms(state) {
  return Object.values(state.farms).filter(farm => farm.status === "pending" && state.completed[section(farm.unlockCampaign)] >= stage(farm.unlockCampaign));
}

// Older saved plans keep their actual farm crews until the user confirms a
// change in-game. Offer surplus releases without silently freeing those workers.
export function surplusFarmCrews(state) {
  const speed = calculateGlobalSpeedMultiplier(state.input);
  return Object.values(state.farms).filter(farm => farm.status === "reserved").flatMap(farm => {
    const workers = { ...farm.workers };
    const required = MISSION_DATA.find(row => row.name === farm.name).minutes / (speed * (2 / 60));
    let power = TYPE_ORDER.reduce((total, type) => total + workers[type] * state.input.workers[type].power, 0);
    if (power < required) return [];
    for (const type of [...TYPE_ORDER].reverse()) {
      const unit = state.input.workers[type].power;
      const remove = unit > 0 ? Math.min(workers[type], Math.max(0, Math.floor((power - required) / unit))) : workers[type];
      workers[type] -= remove;
      power -= remove * unit;
    }
    return sameCrew(workers, farm.workers) ? [] : [{ name: farm.name, workers }];
  });
}

export function campaignStartProblem(state, name, now = Date.now()) {
  const job = state.missions[name];
  if (!job || job.status !== "queued") return "This campaign is not queued.";
  if (dueMissions(state, now).length) return "Confirm finished campaigns before starting another.";
  if (Object.values(state.missions).some(active => active.section === job.section && active.status === "running")) return "This section already has a running campaign.";
  if (stage(name) !== state.completed[job.section] + 1) return "Complete the previous campaign first.";
  const required = SECTION_REQUIREMENTS[job.section];
  if (required && state.completed[required.section] < required.stage) return `Complete ${required.section}-${required.stage} first.`;
  if (dueFarms(state).length) return "Confirm the newly unlocked farm assignments first.";
  if (state.input.awayEnabled && now < state.input.awayUntil && job.plannedStartHours > 0) return "Queued for your return. Turn off Away mode and update the plan if you are back early.";
  // Follow event order, not elapsed wall time: a delayed or unconfirmed launch
  // must not make crews from a later step appear available ahead of schedule.
  const before = Object.values(state.missions).filter(other => other.name !== name && other.status !== "completed" &&
    (other.plannedEndHours <= job.plannedStartHours + 1e-9 ||
      (other.status === "queued" && other.plannedStartHours < job.plannedStartHours - 1e-9)));
  if (before.length) return `Queued after ${before.map(other => other.name).join(", ")}. Follow the current launches or update the plan.`;
  const free = trackerFreeWorkers(state);
  if (TYPE_ORDER.some(type => job.workers[type] > free[type])) return "Wait for the required workers to be released, or update the plan.";
  const pendingFarms = Object.values(state.farms).filter(farm => farm.status === "pending");
  const reservations = createFarmReservations(farmRows(pendingFarms));
  const returnHours = state.input.awayEnabled ? Math.max(0, (state.input.awayUntil - now) / 3600000) : 0;
  const running = Object.values(state.missions).filter(item => item.status === "running").map(item => ({ ...item, endHours: Math.max(returnHours, (item.endsAt - now) / 3600000) }));
  if (!checkFarmReservationHorizon(free, running, { ...job, endHours: Math.max(returnHours, job.durationMs / 3600000) }, reservations).feasible) return "These workers will be needed by an upcoming farm unlock. Update the plan or wait.";
  return null;
}

export function trackerActions(state, now = Date.now()) {
  const finished = dueMissions(state, now);
  const farms = dueFarms(state);
  const candidates = Object.values(state.missions).filter(job => !campaignStartProblem(state, job.name, now)).sort((a, b) => a.plannedStartHours - b.plannedStartHours || a.name.localeCompare(b.name));
  // The entire displayed batch must be feasible, including restored old plans.
  const preview = { ...state, missions: { ...state.missions } };
  const ready = [];
  for (const job of candidates) {
    if (campaignStartProblem(preview, job.name, now)) continue;
    ready.push(job);
    preview.missions[job.name] = { ...job, status: "running", endsAt: now + job.durationMs };
  }
  const running = Object.values(state.missions).filter(job => job.status === "running").sort((a, b) => a.endsAt - b.endsAt);
  const complete = CAMPAIGN_SECTIONS.every(key => state.completed[key] >= state.targets[key]) && !farms.length;
  return { finished, farms, ready, running, complete, surplusFarms: surplusFarmCrews(state) };
}

export function transitionTracker(state, action, now = Date.now()) {
  const next = structuredClone(state);
  const job = next.missions[action.name];
  if (action.type === "start") {
    const problem = campaignStartProblem(state, action.name, now);
    if (problem) throw new Error(problem);
    if (!validDate(now + job.durationMs)) throw new Error("This timer is outside the supported date range. Update the plan.");
    Object.assign(job, { status: "running", startedAt: now, endsAt: now + job.durationMs, imported: false });
  } else if (action.type === "complete") {
    if (!job || job.status !== "running" || job.endsAt > now) throw new Error("Confirm completion when the timer reaches zero. Correct the remaining time first if the game has finished earlier.");
    if (stage(job.name) !== next.completed[job.section] + 1) throw new Error("Campaign progress is out of order.");
    job.status = "completed";
    job.completedAt = now;
    next.completed[job.section] = stage(job.name);
  } else if (action.type === "correct") {
    if (!job || job.status !== "running" || !Number.isFinite(action.remainingHours) || action.remainingHours < 0 || !validDate(now + action.remainingHours * 3600000)) throw new Error("Enter a valid, non-negative remaining time in hours.");
    job.endsAt = now + Math.ceil(action.remainingHours * 3600000);
    job.notifiedFor = null;
    // A corrected game timer has an unknown original duration.
    job.imported = true;
  } else if (action.type === "farm") {
    const farm = next.farms[action.name];
    if (!dueFarms(state).some(item => item.name === action.name)) throw new Error("This farm is not ready to start.");
    if (dueMissions(state, now).length) throw new Error("Confirm finished campaigns first.");
    const free = trackerFreeWorkers(state);
    if (TYPE_ORDER.some(type => farm.workers[type] > free[type])) throw new Error("Not enough released workers to staff this farm. Update the plan.");
    farm.status = "reserved";
  } else if (action.type === "trim-farm") {
    const adjustment = surplusFarmCrews(state).find(farm => farm.name === action.name);
    if (!adjustment) throw new Error("This farm has no surplus crew to release.");
    next.farms[action.name].workers = adjustment.workers;
  } else if (action.type === "notifications") {
    next.notificationsEnabled = Boolean(action.enabled);
  } else throw new Error("Unknown tracker action.");
  next.needsUpdate = action.type === "notifications" ? state.needsUpdate : true;
  next.revision++;
  next.savedAt = now;
  return next;
}

export function trackerProgress(state, now = Date.now()) {
  return Object.fromEntries(CAMPAIGN_SECTIONS.map(key => {
    const active = Object.values(state.missions).find(job => job.section === key && job.status === "running");
    return [key, { completed: state.completed[key], target: state.targets[key], active: active ? { remainingHours: Math.max(0, (active.endsAt - now) / 3600000), workers: { ...active.workers } } : null }];
  }));
}

export function prepareTrackerUpdate(state, rawInput, now = Date.now()) {
  if (dueMissions(state, now).length) throw new Error("Confirm the finished campaigns before updating the remaining plan.");
  const progress = trackerProgress(state, now);
  CAMPAIGN_SECTIONS.forEach(key => { progress[key].target = Math.max(progress[key].completed + (progress[key].active ? 1 : 0), Number(rawInput.shortsProgress?.[key]?.target) || 0); });
  const { input, errors } = validateInput({ ...rawInput, campaignEnabled: true, shortsEnabled: true, shortsProgress: progress });
  if (errors.length) throw Object.assign(new Error("Check the highlighted settings before updating your plan."), { errors });
  return { input, reservedFarms: farmRows(Object.values(state.farms).filter(farm => farm.status === "reserved")), startedAt: now, revision: state.revision };
}

export function mergeTrackerUpdate(state, result, input, plannedAt, now = Date.now()) {
  if (result.solutionStatus === "cancelled-best") throw new Error("Update cancelled. Your existing tracker and timers have been kept.");
  const fresh = createTracker(result, input, plannedAt);
  for (const job of Object.values(state.missions)) {
    if (job.status === "completed") fresh.missions[job.name] = structuredClone(job);
    if (job.status === "running") {
      const replacement = fresh.missions[job.name];
      if (!replacement || replacement.status !== "running" || !sameCrew(job.workers, replacement.workers)) throw new Error("The update would change a locked campaign crew. Your existing plan has been kept.");
      fresh.missions[job.name] = structuredClone(job);
    }
  }
  fresh.farms = farmsFromResult(result, false);
  Object.values(state.farms).filter(farm => farm.status === "reserved").forEach(farm => { fresh.farms[farm.name] = structuredClone(farm); });
  fresh.completed = { ...state.completed };
  fresh.notificationsEnabled = state.notificationsEnabled;
  fresh.revision = state.revision + 1;
  fresh.savedAt = now;
  fresh.needsUpdate = dueMissions(fresh, now).length > 0;
  return fresh;
}

export function pendingNotifications(state, now = Date.now()) {
  return state.notificationsEnabled ? dueMissions(state, now).filter(job => job.notifiedFor !== job.endsAt) : [];
}

// Read-only validation keeps a corrupt save from creating unsafe launch actions.
export function validateTracker(state) {
  if (!state || state.schemaVersion !== 1 || !validDate(state.plannedAt) || !validDate(state.savedAt) || !Number.isSafeInteger(state.revision) || state.revision < 0 || typeof state.notificationsEnabled !== "boolean" || typeof state.needsUpdate !== "boolean") throw new Error("Invalid tracker header.");
  if (validateInput(state.input).errors.length || !state.input.shortsEnabled || !state.input.campaignEnabled) throw new Error("Invalid tracker settings.");
  const plan = state.result?.shortsPlan;
  if (plan?.status !== "best-found" || !Number.isFinite(plan.totalHours) || !Array.isArray(plan.jobs) || !Array.isArray(plan.steps) || !Array.isArray(plan.farmEvents) || !Array.isArray(state.result.assignments) || !Array.isArray(state.result.notices) || !Array.isArray(state.result.selectedFarmNames) || !state.result.totals || !state.result.unassignedWorkers || !plan.certificate || !Array.isArray(plan.unresolved)) throw new Error("Invalid saved plan.");
  if (plan.jobs.length > 48 || plan.steps.length > 49 || Object.keys(state.missions || {}).length > 48 || Object.keys(state.farms || {}).length > 16) throw new Error("Invalid tracker size.");
  const validJob = job => job && ALL_CAMPAIGN_MISSIONS.includes(job.name) && job.section === section(job.name) && withinCap(job.name, job.workers, job.cap) && Number.isFinite(job.startHours) && Number.isFinite(job.endHours) && job.startHours >= 0 && job.endHours > job.startHours && (job.finishHours == null || (Number.isFinite(job.finishHours) && job.finishHours > job.startHours && job.finishHours <= job.endHours));
  const validFarm = farm => farm && ALL_FARM_MISSIONS.includes(farm.name) && withinCap(farm.name, farm.workers) && farm.unlockCampaign === farmUnlockCampaign(farm.name);
  if (!plan.jobs.every(validJob) || !plan.farmEvents.every(validFarm) || !state.result.notices.every(text => typeof text === "string") || !state.result.selectedFarmNames.every(name => ALL_FARM_MISSIONS.includes(name)) || !plan.unresolved.every(name => ALL_CAMPAIGN_MISSIONS.includes(name))) throw new Error("Invalid plan contents.");
  if (!state.result.assignments.every(row => row && [...ALL_CAMPAIGN_MISSIONS, ...ALL_FARM_MISSIONS].includes(row.name) && TYPE_ORDER.includes(row.type) && Number.isSafeInteger(row.count) && row.count > 0)) throw new Error("Invalid saved allocation.");
  if (!CAMPAIGN_SECTIONS.every(key => state.result.shortsProgress?.[key] && Number.isInteger(state.result.shortsProgress[key].target))) throw new Error("Missing saved progress.");
  for (const key of CAMPAIGN_SECTIONS) {
    if (!Number.isInteger(state.completed?.[key]) || !Number.isInteger(state.targets?.[key]) || state.completed[key] < 0 || state.completed[key] > state.targets[key] || state.targets[key] > 12) throw new Error("Invalid campaign progress.");
    if (Object.values(state.missions).filter(job => job.section === key && job.status === "running").length > 1) throw new Error("Multiple running campaigns in one section.");
    for (let number = state.completed[key] + 1; number <= state.targets[key]; number++) if (!state.missions[`${key}-${number}`]) throw new Error("Missing tracked campaign.");
  }
  for (const [name, job] of Object.entries(state.missions)) {
    if (!ALL_CAMPAIGN_MISSIONS.includes(name) || job.name !== name || job.section !== section(name) || !withinCap(name, job.workers, job.cap) || !Number.isFinite(job.durationMs) || job.durationMs <= 0 || !validDate(state.plannedAt + job.durationMs) || !Number.isFinite(job.plannedStartHours) || !Number.isFinite(job.plannedEndHours) || typeof job.imported !== "boolean" || (job.notifiedFor != null && !validDate(job.notifiedFor)) || !["queued", "running", "completed"].includes(job.status)) throw new Error("Invalid tracked mission.");
    if (job.status === "running" && (!validDate(job.endsAt) || (job.startedAt != null && !validDate(job.startedAt)) || stage(name) !== state.completed[job.section] + 1)) throw new Error("Invalid active timer.");
    if (job.status === "completed" && (stage(name) > state.completed[job.section] || !validDate(job.completedAt))) throw new Error("Invalid completion.");
    if (job.status === "queued" && stage(name) <= state.completed[job.section]) throw new Error("Invalid queued campaign.");
  }
  for (const [name, farm] of Object.entries(state.farms)) {
    if (!ALL_FARM_MISSIONS.includes(name) || farm.name !== name || farm.unlockCampaign !== farmUnlockCampaign(name) || !withinCap(name, farm.workers) || !["pending", "reserved"].includes(farm.status)) throw new Error("Invalid tracked farm.");
    if (farm.status === "reserved" && state.completed[section(farm.unlockCampaign)] < stage(farm.unlockCampaign)) throw new Error("Reserved farm is still locked.");
  }
  if (Object.values(trackerFreeWorkers(state)).some(count => count < 0)) throw new Error("Saved workers are double booked.");
  for (const step of plan.steps) if (!Number.isFinite(step.timeHours) || ![step.completed, step.launches, step.running, step.farmStarts].every(Array.isArray) || !step.completed.every(name => ALL_CAMPAIGN_MISSIONS.includes(name)) || !step.launches.every(validJob) || !step.running.every(validJob) || !step.farmStarts.every(validFarm)) throw new Error("Invalid saved steps.");
  return state;
}

export function saveTracker(state, storage = window.localStorage) {
  storage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(state));
}

export function clearTracker(storage = window.localStorage) {
  storage.removeItem(TRACKER_STORAGE_KEY);
}

export function loadTracker(storage = window.localStorage) {
  try {
    const text = storage.getItem(TRACKER_STORAGE_KEY);
    return { state: text ? validateTracker(JSON.parse(text)) : null, warning: "" };
  } catch {
    try { clearTracker(storage); } catch { /* Keep ordinary settings untouched. */ }
    return { state: null, warning: "The saved mission tracker could not be restored. Your optimiser settings have been kept." };
  }
}
