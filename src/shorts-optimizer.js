import { MISSION_DATA, TYPE_ORDER } from "./data.js?v=3.2.6";
import { CAMPAIGN_SECTIONS, calculateGlobalSpeedMultiplier, getVisibleFarmNames, validateInput } from "./validation.js?v=3.2.6";
import { optimize, OptimizerValidationError } from "./optimizer.js?v=3.2.6";
import { optimizeCrazy } from "./crazy-optimizer.js?v=3.2.6";
import { createSeededRandom, deriveSeed, formatRunId } from "./random.js?v=3.2.6";
import { exactShorts, refineShorts, balancedShorts, polishShorts, shortsLowerBound } from "./shorts-search.js?v=3.2.6";
import { checkFarmReservationHorizon, createFarmReservations, farmEventsForJobs, reserveUnlockedFarms } from "./farm-reservations.js?v=3.2.6";
import { campaignPrerequisite, includeCampaignPrerequisites, isCampaignReady } from "./campaign-unlocks.js?v=3.2.6";
import { mergeTrackedFarms, reserveTrackedFarms } from "./tracked-farms.js?v=3.2.6";
import { awayHoursRemaining, campaignTiming } from "./away-mode.js?v=3.2.6";

const MIN_HOURS = 2 / 3600;
const MISSIONS = new Map(MISSION_DATA.map(mission => [mission.name, mission]));
const counts = value => Object.fromEntries(TYPE_ORDER.map(type => [type, value?.[type] || 0]));
const sumCounts = workers => TYPE_ORDER.reduce((sum, type) => sum + workers[type], 0);

function permutations(values) {
  return values.length ? values.flatMap(value => permutations(values.filter(other => other !== value)).map(rest => [value, ...rest])) : [[]];
}

// Workers stay committed until completion. Newly unlocked farms take priority
// over subsequent launches and keep their assigned crews for the rest of the plan.
export function planShorts(input, availableWorkers, onProgress = () => {}, farmReservations = {}, plannedAt = Date.now()) {
  input = { ...input, shortsProgress: includeCampaignPrerequisites(input.shortsProgress) };
  const awayHours = awayHoursRemaining(input, plannedAt);
  const speed = calculateGlobalSpeedMultiplier(input);
  const capMultiplier = input.ouroUnlocked ? 1 + input.relic11Level * 0.5 : 1;
  const types = [...TYPE_ORDER].sort((a, b) => input.workers[b].power - input.workers[a].power);
  const powerOf = workers => TYPE_ORDER.reduce((sum, type) => sum + workers[type] * input.workers[type].power, 0);
  const chains = CAMPAIGN_SECTIONS.map(section => {
    const progress = input.shortsProgress[section];
    return Array.from({ length: progress.target - progress.completed }, (_, index) => {
      const mission = MISSIONS.get(`${section}-${progress.completed + index + 1}`);
      return { name: mission.name, section, chain: CAMPAIGN_SECTIONS.indexOf(section), prerequisite: campaignPrerequisite(mission.name, input.shortsProgress), work: mission.minutes / 60 / speed, cap: Math.round(mission.cap * capMultiplier) };
    });
  });
  const initialJobs = [];
  const initialFree = counts(availableWorkers);
  CAMPAIGN_SECTIONS.forEach((section, chain) => {
    const active = input.shortsProgress[section].active;
    if (!active) return;
    const workers = counts(active.workers);
    initialJobs.push({ ...chains[chain][0], chain, workers, startHours: 0, ...campaignTiming(0, active.remainingHours, awayHours), alreadyRunning: true });
    TYPE_ORDER.forEach(type => { initialFree[type] -= workers[type]; });
  });

  // Allocate in batches, avoiding a loop for each individual worker.
  function allocate(free, job, share) {
    const workers = counts();
    const desiredPower = Math.min(powerOf(free) * share, job.work / MIN_HOURS);
    let power = 0;
    let slots = job.cap;
    for (const type of types) {
      const unitPower = input.workers[type].power;
      if (!(unitPower > 0) || slots <= 0 || power >= desiredPower) continue;
      const count = Math.min(free[type], slots, Math.max(0, Math.ceil((desiredPower - power) / unitPower)));
      workers[type] = count;
      power += count * unitPower;
      slots -= count;
    }
    return { workers, power };
  }

  // Each chromosome sets a section priority and a power-sharing policy at each event.
  // Full allocations, balanced chains, short-first and mutations compete by final ETA.
  const orders = permutations([0, 1, 2, 3]);
  const sharePolicies = awayHours > 0 ? 9 : 7;
  const policyCount = sharePolicies * 2;
  function simulate(genes) {
    const free = counts(initialFree);
    const next = chains.map((_, index) => initialJobs.some(job => job.chain === index) ? 1 : 0);
    const jobs = initialJobs.map(job => ({ ...job }));
    let running = [...jobs];
    let time = 0;
    let event = 0;
    while (next.some((index, chain) => index < chains[chain].length) || running.length) {
      const gene = genes[event] ?? genes[0];
      const policy = gene % policyCount % sharePolicies;
      const allowWaiting = gene % policyCount >= sharePolicies;
      let ready = orders[Math.floor(gene / policyCount)].filter(chain => next[chain] < chains[chain].length && !running.some(job => job.chain === chain) && isCampaignReady(chains[chain][next[chain]], jobs, time));
      const remainingWork = chain => chains[chain].slice(next[chain]).reduce((sum, job) => sum + job.work, 0);
      if (policy === 5) ready.sort((a, b) => remainingWork(b) - remainingWork(a));
      if (policy === 6) ready.sort((a, b) => chains[a][next[a]].work - chains[b][next[b]].work);
      while (ready.length) {
        const chain = ready[0];
        const job = chains[chain][next[chain]];
        let share = 1;
        if (policy === 1) share = 1 / ready.length;
        if (policy === 2 || policy === 5) share = remainingWork(chain) / ready.reduce((sum, index) => sum + remainingWork(index), 0);
        if (policy === 3) share = 0.5;
        if (policy === 4) share = 0.75;
        if (ready.length === 1) share = 1;
        // Include crews sized to finish at return, and splits proportional to
        // the immediately available missions, alongside the normal policies.
        if (time === 0 && awayHours > 0 && policy === 7) share = Math.min(1, job.work / awayHours / powerOf(free));
        if (time === 0 && policy === 8) share = job.work / ready.reduce((sum, index) => sum + chains[index][next[index]].work, 0);
        let allocation = allocate(free, job, share);
        const limits = { ...free };
        // Tighten a crew if it would occupy workers needed by an earlier unlock.
        for (let attempt = 0; allocation.power > 0 && attempt < 16; attempt++) {
          const candidate = { ...job, workers: allocation.workers, ...campaignTiming(time, Math.max(MIN_HOURS, job.work / allocation.power), awayHours) };
          const horizon = checkFarmReservationHorizon(free, running, candidate, farmReservations);
          if (horizon.feasible) break;
          if (horizon.timeHours >= candidate.endHours || attempt === 15) { allocation = { power: 0 }; break; }
          TYPE_ORDER.forEach(type => { limits[type] = Math.max(0, Math.min(limits[type], allocation.workers[type] + horizon.remaining[type])); });
          allocation = allocate(limits, job, share);
        }
        if (allocation.power > 0) {
          const duration = Math.max(MIN_HOURS, job.work / allocation.power);
          // Sometimes waiting briefly for a stronger crew beats locking a weak crew
          // into a long mission now. Compare policies both with and without waiting.
          if (allowWaiting && running.length) {
            const release = Math.min(...running.map(active => active.endHours));
            const futureFree = counts(free);
            running.filter(active => active.endHours === release).forEach(active => {
              TYPE_ORDER.forEach(type => { futureFree[type] += active.workers[type]; });
            });
            const future = allocate(futureFree, job, 1);
            if (future.power > 0 && release - time + Math.max(MIN_HOURS, job.work / future.power) < duration) {
              ready.shift();
              continue;
            }
          }
          const { finishHours, endHours } = campaignTiming(time, duration, awayHours);
          if (!Number.isFinite(endHours) || endHours <= time) return { jobs, totalHours: Infinity, genes };
          const launched = { ...job, chain, workers: allocation.workers, startHours: time, finishHours, endHours, alreadyRunning: false };
          TYPE_ORDER.forEach(type => { free[type] -= allocation.workers[type]; });
          jobs.push(launched);
          running.push(launched);
          next[chain]++;
        }
        ready.shift();
      }
      if (!running.length) return { jobs, totalHours: Infinity, genes };
      time = Math.min(...running.map(job => job.endHours));
      const finished = running.filter(job => job.endHours <= time);
      finished.forEach(job => TYPE_ORDER.forEach(type => { free[type] += job.workers[type]; }));
      if (!reserveUnlockedFarms(free, finished, farmReservations)) return { jobs, totalHours: Infinity, genes, farmBlockedAt: time };
      running = running.filter(job => job.endHours > time);
      event++;
    }
    return { jobs, totalHours: time, genes };
  }

  const seed = deriveSeed({ progress: input.shortsProgress, workers: input.workers, availableWorkers, speed, capMultiplier, ...(awayHours > 0 ? { awayHours } : {}) });
  const random = createSeededRandom(seed);
  let best = null;
  const total = orders.length * policyCount + 320;
  for (let trial = 0; trial < total; trial++) {
    let genes;
    if (trial < orders.length * policyCount) genes = Array(49).fill(trial);
    else {
      genes = [...best.genes];
      // Periodically explore a fresh policy rather than only polishing the incumbent.
      if (trial % 8 === 0) genes.fill(Math.floor(random() * orders.length * policyCount));
      const mutations = trial % 3 === 0 ? 8 : 2;
      for (let index = 0; index < mutations; index++) genes[Math.floor(random() * 49)] = Math.floor(random() * orders.length * policyCount);
    }
    const candidate = simulate(genes);
    if (!best || candidate.totalHours < best.totalHours || (candidate.totalHours === best.totalHours && candidate.jobs.length > best.jobs.length)) best = candidate;
    if (trial % 16 === 0) onProgress({ phase: "shorts-planning", determinate: true, completed: trial, total });
  }
  const baselineHours = best.totalHours;
  const refined = refineShorts(chains, initialJobs, availableWorkers, input.workers, best, random, onProgress, input.searchEffort === "crazy" ? 8000 : 2400, farmReservations, awayHours);
  const balanced = balancedShorts(chains, initialJobs, availableWorkers, input.workers, refined, farmReservations, awayHours);
  const rebalanced = balanced.totalHours < refined.totalHours
    ? refineShorts(chains, initialJobs, availableWorkers, input.workers, balanced, random, onProgress, input.searchEffort === "crazy" ? 8000 : 2400, farmReservations, awayHours)
    : { ...refined, trials: 0 };
  const polished = polishShorts(chains, initialJobs, availableWorkers, input.workers, rebalanced, onProgress, input.searchEffort === "crazy" ? 12000 : 6000, farmReservations, awayHours);
  const exact = exactShorts(chains, initialJobs, availableWorkers, input.workers, polished, 100000, farmReservations, awayHours);
  best = exact;
  const next = chains.map((_, chain) => initialJobs.some(job => job.chain === chain) ? 1 : 0);
  let lowerBoundHours = shortsLowerBound(chains, availableWorkers, input.workers, initialJobs, 0, next, farmReservations);
  if (exact.exhausted) lowerBoundHours = best.totalHours;
  const finite = Number.isFinite(best.totalHours) && Number.isFinite(lowerBoundHours);
  // The denominator is the lower bound: this is a conservative upper bound on
  // how far the plan can be above the true optimum, not an estimated error.
  const relativeGap = finite ? (best.totalHours === 0 ? 0 : Math.max(0, best.totalHours / lowerBoundHours - 1)) : null;
  const certificate = {
    lowerBoundHours, relativeGap,
    provenOptimal: finite && (exact.exhausted || relativeGap <= 1e-9),
    method: exact.exhausted ? "exhaustive" : "work-and-chain-bound",
    nodes: exact.nodes
  };
  const jobs = best.jobs.map(({ chain, work, ...job }) => job);
  const farmEvents = farmEventsForJobs(jobs, farmReservations).filter(event => best.farmBlockedAt == null || event.timeHours < best.farmBlockedAt);
  const times = [...new Set([0, ...jobs.map(job => job.endHours)])].sort((a, b) => a - b);
  const steps = times.map(timeHours => ({
    timeHours,
    completed: jobs.filter(job => job.endHours === timeHours).map(job => job.name),
    farmStarts: farmEvents.filter(event => event.timeHours === timeHours),
    launches: jobs.filter(job => job.startHours === timeHours && !job.alreadyRunning),
    running: jobs.filter(job => job.startHours <= timeHours && job.endHours > timeHours)
  }));
  const unresolved = chains.flat().filter(job => !jobs.some(scheduled => scheduled.name === job.name)).map(job => job.name);
  return { jobs, steps, farmEvents, awayHours, farmBlockedAt: best.farmBlockedAt ?? null, totalHours: best.totalHours, baselineHours, certificate, unresolved, availableWorkers: counts(availableWorkers), searched: total + refined.trials + balanced.trials + rebalanced.trials + polished.trials, status: Number.isFinite(best.totalHours) ? "best-found" : "blocked" };
}

function finishShorts(input, farmResult, locked, onProgress, futureFarms = { assignments: [], selectedFarmNames: [] }, prerequisiteTargets = [], plannedAt = Date.now()) {
  const available = Object.fromEntries(TYPE_ORDER.map(type => [type, farmResult.unassignedWorkers[type] + locked[type]]));
  const shortsPlan = planShorts(input, available, onProgress, createFarmReservations(futureFarms.assignments), plannedAt);
  shortsPlan.futureFarmNames = futureFarms.selectedFarmNames;
  shortsPlan.unstaffedFarmNames = futureFarms.selectedFarmNames.filter(name => !futureFarms.assignments.some(assignment => assignment.name === name && assignment.count > 0));
  if (shortsPlan.unstaffedFarmNames.length) {
    shortsPlan.status = "blocked";
    shortsPlan.totalHours = Infinity;
    shortsPlan.certificate = { ...shortsPlan.certificate, relativeGap: null, provenOptimal: false };
  }
  const starting = shortsPlan.jobs.filter(job => job.startHours === 0);
  const assignments = [...farmResult.assignments, ...starting.flatMap(job => TYPE_ORDER.filter(type => job.workers[type] > 0).map(type => ({ name: job.name, type, count: job.workers[type] })))];
  const unassignedWorkers = counts(available);
  starting.forEach(job => TYPE_ORDER.forEach(type => { unassignedWorkers[type] -= job.workers[type]; }));
  const notices = farmResult.notices.filter(notice => notice !== "No personnel could be assigned with the current inputs.");
  if (prerequisiteTargets.length) notices.push(`This plan also completes through ${prerequisiteTargets.join(" and ")} to unlock your selected campaign sections.`);
  if (shortsPlan.status === "blocked") notices.push("Not enough usable personnel remain after farms to finish these targets. Reduce concurrent farms or add workers with positive power.");
  if (shortsPlan.farmBlockedAt != null) notices.push("Workers locked in existing campaigns prevent a required farm from being staffed when it unlocks. Update the running campaigns or the concurrent farm selections.");
  if (shortsPlan.unstaffedFarmNames.length) notices.push(`No usable workers are available for these future farms: ${shortsPlan.unstaffedFarmNames.join(", ")}. Reduce the requested farms or add personnel.`);
  if (!shortsPlan.jobs.length && !shortsPlan.unresolved.length) notices.push("All selected campaign targets are already complete.");
  const seed = deriveSeed(input);
  return {
    ...farmResult, assignments, unassignedWorkers, notices, shortsPlan,
    shortsProgress: input.shortsProgress, seed, runId: formatRunId(seed),
    campaignETA: shortsPlan.totalHours, campaignAssigned: starting.reduce((sum, job) => sum + sumCounts(job.workers), 0),
    campaignCapacity: starting.reduce((sum, job) => sum + job.cap, 0),
    solutionStatus: "best-found", modeUsed: `${input.mode} · ${input.ouroUnlocked ? "Shorts Mode" : "Campaign Planner"}`
  };
}

export async function optimizeShorts(rawInput, options = {}) {
  options = { plannedAt: Date.now(), ...options };
  const { input, errors } = validateInput(rawInput);
  if (errors.length) throw new OptimizerValidationError(errors);
  if (options.reservedFarms?.length) {
    const { reservedFarms, ...callbacks } = options;
    const remaining = reserveTrackedFarms(input, reservedFarms);
    const merge = result => mergeTrackedFarms(result, input, reservedFarms);
    const result = await optimizeShorts(remaining, {
      ...callbacks,
      onCheckpoint: callbacks.onCheckpoint ? result => callbacks.onCheckpoint(merge(result)) : undefined
    });
    return merge(result);
  }
  const requestedProgress = input.shortsProgress;
  input.shortsProgress = includeCampaignPrerequisites(input.shortsProgress);
  const prerequisiteTargets = CAMPAIGN_SECTIONS.filter(section => input.shortsProgress[section].target > requestedProgress[section].target).map(section => `${section}-${input.shortsProgress[section].target}`);
  const locked = counts();
  Object.values(input.shortsProgress).forEach(progress => {
    if (progress.active) TYPE_ORDER.forEach(type => { locked[type] += progress.active.workers[type]; });
  });
  const farmInput = {
    ...input, campaignEnabled: false, shortsEnabled: false,
    shortsProgress: undefined,
    selectedFarmMissions: getVisibleFarmNames(input.ouroUnlocked, input.shortsProgress).filter(name => input.selectedCampaignFarmMissions.includes(name)),
    workers: Object.fromEntries(TYPE_ORDER.map(type => [type, { ...input.workers[type], count: input.workers[type].count - locked[type] }]))
  };
  const futureNames = getVisibleFarmNames(input.ouroUnlocked, input.shortsProgress, true).filter(name => input.selectedCampaignFarmMissions.includes(name) && !farmInput.selectedFarmMissions.includes(name));
  const futureInput = result => ({
    ...farmInput,
    selectedFarmMissions: futureNames,
    workers: Object.fromEntries(TYPE_ORDER.map(type => [type, { ...input.workers[type], count: result.unassignedWorkers[type] + locked[type] }]))
  });
  let checkpoint = null;
  let farmResult;
  const farmOptions = {
    ...options,
    onCheckpoint(result) {
      // Keep a complete route available if Overkill is cancelled while farming.
      if (!checkpoint && options.onCheckpoint) {
        const future = futureNames.length ? optimize(futureInput(result)) : undefined;
        options.onCheckpoint(finishShorts(input, result, locked, undefined, future, prerequisiteTargets, options.plannedAt));
      }
      checkpoint = result;
    }
  };
  try {
    farmResult = input.searchEffort === "crazy" ? await optimizeCrazy(farmInput, farmOptions) : optimize(farmInput, farmOptions);
  } catch (error) {
    if (!checkpoint || error instanceof OptimizerValidationError) throw error;
    farmResult = { ...checkpoint, solutionStatus: "best-found", notices: [...checkpoint.notices, `Farm search stopped early: ${error.message}`] };
  }
  let futureFarms;
  if (futureNames.length) {
    let futureCheckpoint;
    try {
      futureFarms = input.searchEffort === "crazy"
        ? await optimizeCrazy(futureInput(farmResult), { onProgress: options.onProgress, onCheckpoint: result => { futureCheckpoint = result; } })
        : optimize(futureInput(farmResult), { onProgress: options.onProgress });
    } catch (error) {
      if (!futureCheckpoint || error instanceof OptimizerValidationError) throw error;
      futureFarms = futureCheckpoint;
      farmResult.notices.push(`Future farm search stopped early: ${error.message}`);
    }
  }
  const result = finishShorts(input, farmResult, locked, options.onProgress, futureFarms, prerequisiteTargets, options.plannedAt);
  options.onCheckpoint?.(result);
  options.onProgress?.({ phase: "complete", determinate: true, completed: 1, total: 1 });
  return result;
}
