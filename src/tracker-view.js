import { CAMPAIGN_SECTIONS } from "./validation.js?v=3.2.6";
import { TYPE_ORDER } from "./data.js?v=3.2.6";
import { SECTION_REQUIREMENTS } from "./campaign-unlocks.js?v=3.2.6";
import { campaignStartProblem, trackerActions, trackerFreeWorkers } from "./shorts-tracker.js?v=3.2.6";
import { formatDuration } from "./progress.js?v=3.2.6";
import { formatLocalETA } from "./eta.js?v=3.2.6";
import { DURATION_PATTERN, parseRemainingTime, formatRemainingTime } from "./duration-input.js?v=3.2.6";

const node = (tag, className = "", text = "") => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};
const workersText = workers => TYPE_ORDER.filter(type => workers[type] > 0).map(type => `${workers[type].toLocaleString()} ${type}${workers[type] === 1 ? "" : "s"}`).join(" · ");
const button = (text, handler, disabled = false, primary = false) => {
  const element = node("button", `action-button${primary ? " action-button--primary" : ""}`, text);
  element.type = "button";
  element.disabled = disabled;
  element.addEventListener("click", handler);
  return element;
};
const remaining = (job, now) => formatDuration(Math.max(0, Math.ceil((job.endsAt - now) / 1000) * 1000));
export const SECTION_TITLES = Object.freeze({ C1: "WASTA-7", C2: "CRYTON", C3: "SON-EGETUAR", C4: "SEKHUR-5" });

export function createTrackerView(root, callbacks) {
  let state = null;
  let options = {};
  let selected = null;
  let lanes = [];
  let actionSignature = "";
  const header = node("div", "tracker-heading");
  const heading = node("h3", "", "Live mission tracker");
  heading.tabIndex = -1;
  const tally = node("span", "tracker-tally");
  header.append(heading, tally);
  const intro = node("p", "tiny-note", "Assign the listed farm crews, then track your campaign starts and finishes.");
  const controls = node("div", "tracker-controls");
  const notice = node("p", "tracker-notice");
  notice.setAttribute("role", "status");
  const notificationHelp = node("p", "tiny-note tracker-notification-help");
  const awayHelp = node("p", "tiny-note tracker-away-help");
  const next = node("section", "tracker-next");
  const nextTitle = node("h4", "", "Available actions now");
  const actionList = node("div", "tracker-actions");
  next.append(nextTitle, actionList);
  const grid = node("div", "tracker-grid");
  const detail = node("div", "tracker-detail");
  detail.setAttribute("role", "status");
  root.replaceChildren(header, intro, controls, notice, notificationHelp, awayHelp, next, grid, detail);

  function showMilestone(name) {
    selected = name;
    const job = state.missions[name];
    const completed = state.completed[name.split("-")[0]] >= Number(name.split("-")[1]);
    detail.replaceChildren(node("strong", "", name));
    if (!job) detail.append(node("p", "", "Completed before tracking."));
    else {
      const status = completed ? "✓ Confirmed complete" : job.status === "running" ? (job.endsAt <= Date.now() ? "Ready to confirm" : "Running") : "Queued";
      detail.append(node("p", "", `${status} · ${workersText(job.workers)}`));
      if (job.status === "queued") detail.append(node("p", "tiny-note", `Estimated duration: ${formatDuration(job.durationMs)}. Planned finish: ${formatLocalETA(state.plannedAt, job.plannedStartHours + job.durationMs / 3600000)} (estimate).`));
      else if (job.status === "running") detail.append(node("p", "tiny-note", `ETA: ${formatLocalETA(job.endsAt, 0)}`));
    }
    detail.hidden = false;
    root.querySelectorAll("[data-milestone]").forEach(element => element.setAttribute("aria-pressed", String(element.dataset.milestone === name)));
  }

  function renderActions(now) {
    const actions = trackerActions(state, now);
    const signature = JSON.stringify([actions.finished.map(job => job.name), actions.surplusFarms, actions.farms.map(farm => farm.name), actions.ready.map(job => job.name), actions.running.map(job => job.name), actions.complete, options.busy, options.settingsChanged]);
    if (signature === actionSignature) {
      const clock = actionList.querySelector("[data-next-countdown]");
      if (clock && actions.running[0]) clock.textContent = `${actions.running[0].name} · ${remaining(actions.running[0], now)} remaining`;
      return;
    }
    actionSignature = signature;
    actionList.replaceChildren();
    const appendAction = (title, description, label, action, disabled) => {
      const row = node("div", "tracker-action");
      const text = node("div");
      text.append(node("strong", "", title), node("p", "tiny-note", description));
      const control = button(label, action, disabled, true);
      control.setAttribute("aria-label", `${label}: ${title}`);
      row.append(text, control);
      actionList.append(row);
    };
    if (actions.finished.length) {
      actions.finished.forEach(job => appendAction(`${job.name} is ready to confirm`, "Confirm once it has finished in-game.", "Confirm finished", () => callbacks.onAction({ type: "complete", name: job.name }), options.busy));
    } else if (actions.surplusFarms.length) {
      actions.surplusFarms.forEach(farm => appendAction(`Reduce ${farm.name} to ${workersText(farm.workers)}`, "This crew still reaches the two-second minimum. Remove the extra workers in-game, confirm here, then update the remaining plan.", "Confirm reduced crew", () => callbacks.onAction({ type: "trim-farm", name: farm.name }), options.busy || options.settingsChanged));
    } else if (actions.farms.length) {
      const free = trackerFreeWorkers(state);
      actions.farms.forEach(farm => {
        const unavailable = TYPE_ORDER.some(type => farm.workers[type] > free[type]);
        appendAction(`Start farming ${farm.name}`, `${workersText(farm.workers)}${unavailable ? " · Waiting for released workers. Update the plan if needed." : " · Keep this crew assigned."}`, "Farm is running", () => callbacks.onAction({ type: "farm", name: farm.name }), options.busy || options.settingsChanged || unavailable);
      });
    } else if (actions.ready.length) {
      actionList.append(node("p", "tiny-note", actions.ready.length > 1 ? "These crews fit together. Launch these missions concurrently, then confirm each start below." : "Launch this mission with the listed crew. Later launches remain queued until their workers and plan step are ready."));
      actions.ready.forEach(job => appendAction(`Launch ${job.name} in-game`, `${workersText(job.workers)} · ${formatDuration(job.durationMs)}`, "Start mission", () => callbacks.onAction({ type: "start", name: job.name }), options.busy || options.settingsChanged));
    } else if (actions.complete) {
      appendAction("All targets confirmed complete", "Finish tracking to plan your next targets.", "Finish tracking", callbacks.onFinish, options.busy);
    } else if (actions.running.length) {
      const clock = node("strong", "", `${actions.running[0].name} · ${remaining(actions.running[0], now)} remaining`);
      clock.dataset.nextCountdown = "true";
      actionList.append(clock, node("p", "tiny-note", "Keep workers assigned until you confirm completion."));
    } else actionList.append(node("p", "", "Update the remaining plan to find the next available allocation."));
  }

  function buildLane(key) {
    const card = node("article", "tracker-lane");
    card.dataset.section = key;
    const top = node("div", "tracker-lane-heading");
    const title = node("h4", "", SECTION_TITLES[key]);
    const status = node("span", "tracker-status");
    top.append(title, status);
    const mission = node("strong", "tracker-mission");
    const progress = node("div", "tracker-progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", `${key} current campaign progress`);
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    const fill = node("div", "tracker-progress-fill");
    progress.append(fill);
    const timer = node("p", "tracker-countdown");
    const eta = node("p", "tiny-note tracker-eta");
    const active = Object.values(state.missions).find(job => job.section === key && job.status === "running");
    card.append(top, mission, progress, timer, eta);
    if (active) {
      const correction = node("details", "tracker-correction");
      const summary = node("summary", "", "Correct remaining time");
      const form = node("form", "tracker-timer-form");
      const label = node("label", "", "Time remaining");
      const input = node("input");
      input.type = "text"; input.className = "time-remaining-input"; input.required = true;
      input.placeholder = "00:00:00"; input.pattern = DURATION_PATTERN;
      input.title = "Hours:minutes:seconds (e.g. 02:30:00)";
      input.autocomplete = "off"; input.spellcheck = false;
      input.value = formatRemainingTime(Math.max(0, (active.endsAt - Date.now()) / 3600000));
      input.disabled = Boolean(options.busy);
      label.append(input);
      const save = button("Save timer", () => {}, options.busy);
      save.type = "submit";
      form.append(label, save);
      form.addEventListener("submit", event => { event.preventDefault(); callbacks.onAction({ type: "correct", name: active.name, remainingHours: parseRemainingTime(input.value) }); });
      correction.addEventListener("toggle", () => { if (correction.open) input.value = formatRemainingTime(Math.max(0, (active.endsAt - Date.now()) / 3600000)); });
      correction.append(summary, form);
      card.append(correction);
    }
    const milestones = node("div", "tracker-milestones");
    milestones.setAttribute("aria-label", `${key} campaign milestones`);
    for (let i = 1; i <= state.targets[key]; i++) {
      const name = `${key}-${i}`;
      const item = button(String(i), () => showMilestone(name));
      item.className = "tracker-milestone";
      item.dataset.milestone = name;
      item.setAttribute("aria-pressed", String(selected === name));
      milestones.append(item);
    }
    card.append(milestones);
    grid.append(card);
    lanes.push({ key, card, mission, status, progress, fill, timer, eta, milestones });
  }

  function tick(now = Date.now()) {
    if (!state) return;
    awayHelp.hidden = !state.input.awayEnabled;
    awayHelp.textContent = state.input.awayUntil > now
      ? `Away mode: back at ${formatLocalETA(state.input.awayUntil, 0)}. Launch the current batch before leaving. Later launches are planned for your return; timers still show actual mission finishes.`
      : "Your away period has ended. Confirm any finished missions, then update the remaining plan. Set a new return time for your next absence.";
    let confirmed = 0;
    let total = 0;
    lanes.forEach(lane => {
      const { key, card, mission, status, progress, fill, timer, eta, milestones } = lane;
      confirmed += state.completed[key]; total += state.targets[key];
      const active = Object.values(state.missions).find(job => job.section === key && job.status === "running");
      const queued = state.missions[`${key}-${state.completed[key] + 1}`];
      const done = state.completed[key] >= state.targets[key];
      const required = SECTION_REQUIREMENTS[key];
      const locked = required && state.completed[required.section] < required.stage && !active && !done;
      const due = active && active.endsAt <= now;
      card.dataset.status = active ? due ? "due" : "running" : done ? "complete" : locked ? "locked" : "waiting";
      status.textContent = active ? due ? "Ready to confirm" : "Running" : state.targets[key] === 0 ? "No target" : done ? "✓ Complete" : locked ? "Locked" : "Waiting";
      mission.textContent = active?.name || (done ? `${state.completed[key]} campaigns completed` : `Next: ${queued?.name || key}`);
      progress.classList.toggle("is-indeterminate", Boolean(active?.imported && !due));
      const value = active ? due ? 100 : active.imported ? null : Math.max(0, Math.min(100, 100 * (now - active.startedAt) / (active.endsAt - active.startedAt))) : done && state.targets[key] ? 100 : 0;
      fill.style.width = value == null ? "35%" : `${value}%`;
      if (value == null) progress.removeAttribute("aria-valuenow");
      else progress.setAttribute("aria-valuenow", String(Math.round(value)));
      progress.setAttribute("aria-valuetext", active ? `${status.textContent}, ${remaining(active, now)} remaining${active.imported ? ", original duration unknown" : ""}` : status.textContent);
      timer.textContent = active ? due ? "Check the game, then confirm completion" : `${remaining(active, now)} remaining${value == null ? " · countdown only" : ` · ${value.toFixed(2)}%`}` : locked ? `Complete ${required.section}-${required.stage} to unlock` : done ? "" : (queued ? campaignStartProblem(state, queued.name, now) || "Ready to launch in-game" : "Update the plan to continue");
      eta.textContent = active ? `ETA: ${formatLocalETA(active.endsAt, 0)}` : queued ? `Planned finish: ${formatLocalETA(state.plannedAt, queued.plannedStartHours + queued.durationMs / 3600000)} (estimate)` : "";
      for (const item of milestones.children) {
        const name = item.dataset.milestone;
        const complete = Number(name.split("-")[1]) <= state.completed[key];
        const running = active?.name === name;
        item.dataset.status = complete ? "complete" : running ? due ? "due" : "running" : "queued";
        item.textContent = `${complete ? "✓ " : ""}${name.split("-")[1]}`;
        item.setAttribute("aria-label", `${name}: ${complete ? "confirmed complete" : running ? status.textContent : "queued"}. Show details.`);
      }
    });
    tally.textContent = `${confirmed} / ${total} confirmed`;
    renderActions(now);
  }

  function render(nextState, nextOptions = {}) {
    state = nextState;
    options = nextOptions;
    root.hidden = !state && !options.previewAvailable;
    controls.replaceChildren();
    next.hidden = grid.hidden = detail.hidden = awayHelp.hidden = !state;
    intro.hidden = Boolean(state);
    notice.hidden = !state;
    notificationHelp.hidden = !state;
    if (!state) {
      tally.textContent = "";
      controls.append(button("Track this plan", callbacks.onTrack, options.busy || options.settingsChanged, true));
      return;
    }
    notice.textContent = options.settingsChanged ? "Update the plan before starting more missions or farms." : state.needsUpdate ? "Update the remaining plan after progress changes." : "Confirm starts and finishes here after checking the game.";
    controls.append(button("Update remaining plan", callbacks.onUpdate, options.busy, true));
    controls.append(button("Start a fresh plan", callbacks.onFreshPlan, options.busy));
    const supported = typeof Notification !== "undefined";
    const enabled = state.notificationsEnabled && supported && Notification.permission === "granted";
    controls.append(button(enabled ? "Notifications on · turn off" : "Notify me", callbacks.onNotify, !supported || options.busy));
    notificationHelp.textContent = !supported ? "Notifications are unavailable in this browser." : Notification.permission === "denied" ? "Allow notifications in your browser’s site settings." : enabled ? "Keep this site open for alerts; background alerts may be delayed." : "Choose Notify me for completion alerts.";
    grid.replaceChildren(); lanes = []; actionSignature = "";
    CAMPAIGN_SECTIONS.filter(key => state.input.ouroUnlocked || key !== "C4").forEach(buildLane);
    if (selected && (state.missions[selected] || state.completed[selected.split("-")[0]] >= Number(selected.split("-")[1]))) showMilestone(selected);
    else detail.hidden = true;
    tick();
  }
  return { render, tick, focus: () => heading.focus({ preventScroll: true }) };
}
