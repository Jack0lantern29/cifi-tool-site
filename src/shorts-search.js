import { TYPE_ORDER } from "./data.js?v=3.2.4";
import { checkFarmReservationHorizon, reserveUnlockedFarms } from "./farm-reservations.js?v=3.2.4";
import { isCampaignReady } from "./campaign-unlocks.js?v=3.2.4";

const MIN_HOURS = 2 / 3600;
const counts = source => Object.fromEntries(TYPE_ORDER.map(type => [type, source?.[type] || 0]));
const sum = values => values.reduce((total, value) => total + value, 0);
const powerOf = (crew, workers) => sum(TYPE_ORDER.map(type => crew[type] * workers[type].power));

function fastestPower(job, available, workers) {
  let slots = job.cap;
  let power = 0;
  for (const type of [...TYPE_ORDER].sort((a, b) => workers[b].power - workers[a].power)) {
    const count = Math.min(slots, available[type]);
    power += count * workers[type].power;
    slots -= count;
  }
  return power;
}

// Independent lower bounds: total power-hours of work, and the fastest possible
// serial path through each chain. Both relax competition between sections.
// Fixed running timers consume their actual reserved crews until completion.
export function shortsLowerBound(chains, available, workers, running = [], time = 0, next = chains.map(() => 0), farmReservations = {}) {
  const totalPower = powerOf(available, workers);
  const minPower = Math.min(...TYPE_ORDER.filter(type => available[type] > 0 && workers[type].power > 0).map(type => workers[type].power));
  let energy = sum(running.map(job => powerOf(job.workers, workers) * (job.endHours - time)));
  let bound = time;
  const earliest = new Map(running.map(job => [job.name, job.endHours]));
  const pending = new Map();
  const chainEnergy = [];
  const chainCaps = [];
  chains.forEach((chain, index) => {
    const active = running.find(job => job.chain === index);
    let chainTime = active ? active.endHours : time;
    let previous = active?.name;
    let work = active ? powerOf(active.workers, workers) * (active.endHours - time) : 0;
    let cap = active ? sum(Object.values(active.workers)) : 0;
    for (const job of chain.slice(next[index])) {
      const fastest = fastestPower(job, available, workers);
      const duration = fastest > 0 ? Math.max(MIN_HOURS, job.work / fastest) : Infinity;
      chainTime += duration;
      const needed = Math.max(job.work, minPower * MIN_HOURS);
      energy += needed;
      work += needed;
      cap = Math.max(cap, job.cap);
      pending.set(job.name, { job, previous, duration, energy: needed });
      previous = job.name;
    }
    chainEnergy.push(work);
    chainCaps.push(cap);
    bound = Math.max(bound, chainTime);
  });
  // The fastest prerequisite path spans sections, e.g. C1-8 -> C2-1.
  // Completed predecessors are absent and contribute no remaining delay.
  function earliestEnd(name) {
    if (!name) return time;
    if (earliest.has(name)) return earliest.get(name);
    const item = pending.get(name);
    if (!item) return time;
    const end = Math.max(time, earliestEnd(item.previous), earliestEnd(item.job.prerequisite)) + item.duration;
    earliest.set(name, end);
    return end;
  }
  for (const name of pending.keys()) bound = Math.max(bound, earliestEnd(name));
  // Once a farm unlocks, its crew stays occupied until the overall finish.
  // Even in the optimistic fastest scenario, every dependent campaign after
  // that unlock still takes time. Charge only that unavoidable holding time;
  // assuming farms unlock at their earliest possible time would be invalid.
  const successors = new Map();
  for (const [name, item] of pending) for (const before of new Set([item.previous, item.job.prerequisite])) if (before) {
    if (!successors.has(before)) successors.set(before, []);
    successors.get(before).push(name);
  }
  const tails = new Map();
  function remainingTail(name) {
    if (!tails.has(name)) tails.set(name, Math.max(0, ...(successors.get(name) || []).map(after => pending.get(after).duration + remainingTail(after))));
    return tails.get(name);
  }
  for (const [unlock, rows] of Object.entries(farmReservations)) {
    const heldPower = sum(rows.map(row => row.count * workers[row.type].power));
    const descendants = new Set();
    function collect(name) {
      for (const after of successors.get(name) || []) if (!descendants.has(after)) { descendants.add(after); collect(after); }
    }
    collect(unlock);
    const remainingWork = sum([...descendants].map(name => pending.get(name).energy));
    // All descendant work happens after this farm's workers are committed.
    const workTail = remainingWork > 0 ? remainingWork / Math.max(0, totalPower - heldPower) : 0;
    if (heldPower > 0) energy += heldPower * Math.max(remainingTail(unlock), workTail);
  }
  if (energy > 0) bound = Math.max(bound, time + (totalPower > 0 ? energy / totalPower : Infinity));
  // A subset of sections cannot use more worker slots at once than the sum
  // of their largest mission caps. This remains an optimistic relaxation:
  // give that subset the strongest workers and ignore other sections/farms.
  for (let mask = 1; mask < (1 << chains.length); mask++) {
    let work = 0, cap = 0;
    for (let index = 0; index < chains.length; index++) if (mask & (1 << index)) {
      work += chainEnergy[index]; cap += chainCaps[index];
    }
    if (work <= 0) continue;
    const power = fastestPower({ cap }, available, workers);
    bound = Math.max(bound, time + (power > 0 ? work / power : Infinity));
  }
  // Round conservatively: numerical noise must not strengthen a certificate.
  return bound * (1 - 1e-12);
}

// Reschedule a set of fixed crews at completion events, preserving locked crews.
function scheduleCrews(chains, initialJobs, available, workers, crews, priorities, farmReservations) {
  const free = counts(available);
  const next = chains.map((_, chain) => initialJobs.some(job => job.chain === chain) ? 1 : 0);
  let running = [...initialJobs];
  const jobs = [...initialJobs];
  initialJobs.forEach(job => TYPE_ORDER.forEach(type => { free[type] -= job.workers[type]; }));
  let time = 0;
  while (running.length || next.some((index, chain) => index < chains[chain].length)) {
    const ready = chains.map((chain, index) => ({ ...chain[next[index]], chain: index }))
      .filter(job => job.name && !running.some(active => active.chain === job.chain) && isCampaignReady(job, jobs, time))
      .sort((a, b) => (priorities[a.name] - priorities[b.name]) || a.chain - b.chain);
    for (const job of ready) {
      const crew = crews[job.name];
      if (!crew || TYPE_ORDER.some(type => crew[type] > free[type])) continue;
      const power = powerOf(crew, workers);
      if (!(power > 0) || sum(Object.values(crew)) > job.cap) return null;
      const endHours = time + Math.max(MIN_HOURS, job.work / power);
      if (!Number.isFinite(endHours) || endHours <= time) return null;
      const launched = { ...job, workers: crew, startHours: time, endHours, alreadyRunning: false };
      if (!checkFarmReservationHorizon(free, running, launched, farmReservations).feasible) continue;
      TYPE_ORDER.forEach(type => { free[type] -= crew[type]; });
      jobs.push(launched);
      running.push(launched);
      next[job.chain]++;
    }
    if (!running.length) return null;
    time = Math.min(...running.map(job => job.endHours));
    running.filter(job => job.endHours === time).forEach(job => TYPE_ORDER.forEach(type => { free[type] += job.workers[type]; }));
    if (!reserveUnlockedFarms(free, running.filter(job => job.endHours === time), farmReservations)) return null;
    running = running.filter(job => job.endHours > time);
  }
  return { jobs, totalHours: time };
}

// Refine actual integer crews, not just dispatch priorities. Transfers, swaps,
// and small changes can balance competing sections far more finely than a few
// fixed percentage splits. Every candidate is rescheduled and checked for locks.
export function refineShorts(chains, initialJobs, available, workers, incumbent, random, onProgress = () => {}, iterations = 2400, farmReservations = {}) {
  if (!Number.isFinite(incumbent.totalHours)) return { ...incumbent, trials: 0 };
  let best = incumbent;
  let current = best;
  let currentScore = sum(current.jobs.map(job => job.endHours));
  const pending = chains.flat().filter(job => !initialJobs.some(active => active.name === job.name));
  if (!pending.length) return { ...best, trials: 0 };
  const types = TYPE_ORDER.filter(type => available[type] > 0 && workers[type].power > 0);
  const fractions = [0, 0.002, 0.01, 0.03, 0.1, 0.25, 0.5];
  for (let trial = 0; trial < iterations; trial++) {
    if (trial % 120 === 0) { current = best; currentScore = sum(current.jobs.map(job => job.endHours)); }
    const crews = Object.fromEntries(current.jobs.map(job => [job.name, { ...job.workers }]));
    const priorities = Object.fromEntries(current.jobs.map(job => [job.name, job.startHours]));
    const a = pending[Math.floor(random() * pending.length)];
    const b = pending[Math.floor(random() * pending.length)];
    const type = types[Math.floor(random() * types.length)];
    const other = types[Math.floor(random() * types.length)];
    const fraction = fractions[Math.floor(random() * fractions.length)];
    const amount = Math.max(1, Math.round(Math.max(crews[a.name][type], 1) * fraction));
    const action = Math.floor(trial / 2) % 4;
    const wholeChain = trial % 2 === 0 && a.chain !== b.chain;
    const teamA = wholeChain ? pending.filter(job => job.chain === a.chain) : [a];
    const teamB = wholeChain ? pending.filter(job => job.chain === b.chain) : [b];
    if (action === 0 && a !== b) {
      const move = Math.min(amount, ...teamA.map(job => crews[job.name][type]));
      teamA.forEach(job => { crews[job.name][type] -= move; });
      teamB.forEach(job => { crews[job.name][type] += move; });
    } else if (action === 1 && a !== b && type !== other) {
      const move = Math.min(amount, ...teamA.map(job => crews[job.name][type]));
      const exchange = Math.min(Math.max(1, Math.round(move * workers[type].power / workers[other].power) + Math.floor(random() * 3) - 1), ...teamB.map(job => crews[job.name][other]));
      if (move && exchange) {
        teamA.forEach(job => { crews[job.name][type] -= move; crews[job.name][other] += exchange; });
        teamB.forEach(job => { crews[job.name][other] -= exchange; crews[job.name][type] += move; });
      }
    } else if (action === 2) {
      crews[a.name][type] = Math.max(0, Math.min(available[type], crews[a.name][type] + (random() < 0.5 ? amount : -amount)));
    } else {
      priorities[a.name] = priorities[b.name];
    }
    if (pending.some(job => sum(Object.values(crews[job.name])) > job.cap || powerOf(crews[job.name], workers) <= 0 || TYPE_ORDER.some(key => crews[job.name][key] > available[key]))) continue;
    const candidate = scheduleCrews(chains, initialJobs, available, workers, crews, priorities, farmReservations);
    if (!candidate) continue;
    const secondary = sum(candidate.jobs.map(job => job.endHours));
    if (candidate.totalHours < best.totalHours || (candidate.totalHours === best.totalHours && secondary < sum(best.jobs.map(job => job.endHours)))) best = candidate;
    // A small, shrinking allowance escapes crew-allocation plateaus; the best
    // feasible plan is retained separately, so exploration cannot worsen it.
    const temperature = 0.003 * (1 - (trial % 120) / 120);
    if (candidate.totalHours < current.totalHours || (candidate.totalHours === current.totalHours && secondary <= currentScore) || random() < Math.exp(-(candidate.totalHours / current.totalHours - 1) / Math.max(temperature, 1e-9)) * 0.025) {
      current = candidate; currentScore = secondary;
    }
    if (trial % 64 === 0) onProgress({ phase: "shorts-refining", determinate: true, completed: trial, total: iterations });
  }
  return { ...best, trials: iterations };
}

// Compare dedicated section crews sized by the total work still to finish.
// This avoids locking all strong workers into one early mission and starving
// another section. Farm crews are set aside even before their future unlocks;
// this is only a candidate construction, never an extra constraint on the plan.
export function balancedShorts(chains, initialJobs, available, workers, incumbent, farmReservations = {}) {
  const pending = chains.map(chain => chain.filter(job => !initialJobs.some(active => active.name === job.name)));
  const work = pending.map(chain => sum(chain.map(job => job.work)));
  const indices = work.map((value, index) => value > 0 ? index : -1).filter(index => index >= 0);
  const permutations = values => values.length ? values.flatMap(value => permutations(values.filter(other => value !== other)).map(rest => [value, ...rest])) : [[]];
  const pool = counts(available);
  Object.values(farmReservations).flat().forEach(row => { pool[row.type] -= row.count; });
  if (TYPE_ORDER.some(type => pool[type] < 0)) return { ...incumbent, trials: 0 };
  const types = [...TYPE_ORDER].filter(type => workers[type].power > 0).sort((a, b) => workers[b].power - workers[a].power);
  let best = incumbent, trials = 0;
  for (const order of permutations(indices)) {
    const weights = [...work];
    for (let iteration = 0; iteration < 12; iteration++) {
      const free = { ...pool };
      const crews = {}, priorities = {};
      let remainingWork = sum(weights);
      for (const index of order) {
        let need = powerOf(free, workers) * weights[index] / remainingWork;
        const team = counts();
        for (const type of types) {
          const amount = Math.min(free[type], Math.max(0, Math.ceil(need / workers[type].power)));
          team[type] = amount; free[type] -= amount; need -= amount * workers[type].power;
        }
        remainingWork -= weights[index];
        for (const job of pending[index]) {
          const crew = counts();
          let slots = job.cap, needed = job.work / MIN_HOURS;
          for (const type of types) {
            const amount = Math.min(team[type], slots, Math.max(0, Math.ceil(needed / workers[type].power)));
            crew[type] = amount; slots -= amount; needed -= amount * workers[type].power;
          }
          crews[job.name] = crew;
          priorities[job.name] = index;
        }
      }
      trials++;
      const candidate = scheduleCrews(chains, initialJobs, available, workers, crews, priorities, farmReservations);
      if (candidate && candidate.totalHours < best.totalHours) best = candidate;
      if (!candidate) break;
      const finishes = indices.map(index => candidate.jobs.find(job => job.name === pending[index].at(-1).name).endHours);
      const average = sum(finishes) / finishes.length;
      // Include unlock delays and early mission caps in the next power split.
      // Damping avoids oscillation when integer crews or event order changes.
      indices.forEach((index, position) => { weights[index] *= Math.sqrt(finishes[position] / average); });
    }
  }
  return { ...best, trials };
}

// Systematically improve the best schedule during the normal run. Coarse-to-
// fine crew changes locate useful regions, then single-worker moves polish
// the finish. Every proposal is rescheduled with locked crews and farm checks.
export function polishShorts(chains, initialJobs, available, workers, incumbent, onProgress = () => {}, budget = 6000, farmReservations = {}) {
  if (!Number.isFinite(incumbent.totalHours)) return { ...incumbent, trials: 0 };
  const fixed = new Set(initialJobs.map(job => job.name));
  const pending = chains.flat().filter(job => !fixed.has(job.name));
  const types = TYPE_ORDER.filter(type => available[type] > 0 && workers[type].power > 0);
  const next = chains.map((_, index) => initialJobs.some(job => job.chain === index) ? 1 : 0);
  const bound = shortsLowerBound(chains, available, workers, initialJobs, 0, next, farmReservations);
  let best = incumbent, trials = 0;
  let score = sum(best.jobs.map(job => job.endHours));
  let crews, priorities;
  const refresh = () => {
    crews = Object.fromEntries(best.jobs.map(job => [job.name, job.workers]));
    priorities = Object.fromEntries(best.jobs.map(job => [job.name, job.startHours]));
  };
  refresh();
  function consider(changes) {
    if (trials >= budget) return;
    const proposal = { ...crews };
    for (const [job, deltas] of changes) {
      const changed = { ...crews[job.name] };
      for (const [type, delta] of Object.entries(deltas)) changed[type] += delta;
      if (TYPE_ORDER.some(type => changed[type] < 0 || changed[type] > available[type]) || sum(Object.values(changed)) > job.cap || powerOf(changed, workers) <= 0) return;
      proposal[job.name] = changed;
    }
    trials++;
    if (trials % 128 === 0) onProgress({ phase: "shorts-polishing", determinate: true, completed: trials, total: budget });
    const candidate = scheduleCrews(chains, initialJobs, available, workers, proposal, priorities, farmReservations);
    if (!candidate) return;
    const secondary = sum(candidate.jobs.map(job => job.endHours));
    if (candidate.totalHours < best.totalHours || (candidate.totalHours === best.totalHours && secondary < score)) {
      best = candidate; score = secondary; refresh();
    }
  }
  const scales = [0.25, 0.0625, 0.015625, 0.00390625, 0.0009765625, 0];
  for (let pass = 0; pass < 3 && trials < budget && best.totalHours > bound * (1 + 1e-9); pass++) {
    const before = best;
    for (const scale of scales) {
      // Finish-time order prioritises sections holding up the final target.
      const ordered = [...pending].sort((a, b) => best.jobs.find(job => job.name === b.name).endHours - best.jobs.find(job => job.name === a.name).endHours);
      for (const job of ordered) {
        if (trials >= budget) break;
        for (const type of types) {
          const amount = Math.max(1, Math.round(crews[job.name][type] * scale));
          consider([[job, { [type]: amount }]]);
          consider([[job, { [type]: -amount }]]);
          // Replace a weaker type without exceeding the mission's slot cap.
          for (const other of types) if (workers[other].power < workers[type].power && crews[job.name][other] > 0) {
            const swap = Math.min(Math.max(1, Math.round(crews[job.name][other] * scale)), crews[job.name][other]);
            consider([[job, { [type]: swap, [other]: -swap }]]);
          }
          const current = best.jobs.find(item => item.name === job.name);
          for (const donor of ordered) {
            if (donor.chain === job.chain || !crews[donor.name][type]) continue;
            const scheduled = best.jobs.find(item => item.name === donor.name);
            if (scheduled.endHours <= current.startHours || scheduled.startHours >= current.endHours) continue;
            const move = Math.min(Math.max(1, Math.round(crews[donor.name][type] * scale)), crews[donor.name][type]);
            consider([[job, { [type]: move }], [donor, { [type]: -move }]]);
          }
        }
      }
    }
    if (before === best) break;
  }
  return { ...best, trials };
}

// Exhaustive event-based branch-and-bound for small crews. Every nonempty
// integer crew and every subset of ready chains is considered, including waiting.
// If the node budget is exhausted, no optimality claim is made.
export function exactShorts(chains, initialJobs, available, workers, incumbent, nodeLimit = 100000, farmReservations = {}) {
  const positive = TYPE_ORDER.filter(type => available[type] > 0 && workers[type].power > 0);
  const pendingCount = chains.flat().length - initialJobs.length;
  if (sum(positive.map(type => available[type])) > 6 || pendingCount > 8 || !Number.isFinite(incumbent.totalHours)) return { ...incumbent, exhausted: false, nodes: 0 };
  let best = incumbent;
  let nodes = 0;
  let exhausted = true;
  function visit(time, next, running, free, jobs) {
    if (++nodes > nodeLimit) { exhausted = false; return; }
    if (shortsLowerBound(chains, available, workers, running, time, next) >= best.totalHours * (1 - 2e-12)) return;
    if (!running.length && next.every((index, chain) => index === chains[chain].length)) { best = { jobs, totalHours: time }; return; }
    const ready = chains.map((chain, index) => ({ ...chain[next[index]], chain: index })).filter(job => job.name && !running.some(active => active.chain === job.chain) && isCampaignReady(job, jobs, time));
    function dispatch(index, reserved, started, advanced) {
      if (!exhausted) return;
      if (index === ready.length) {
        if (!started.length) return;
        const end = Math.min(...started.map(job => job.endHours));
        if (end >= best.totalHours) return;
        const released = counts(reserved);
        started.filter(job => job.endHours === end).forEach(job => TYPE_ORDER.forEach(type => { released[type] += job.workers[type]; }));
        if (!reserveUnlockedFarms(released, started.filter(job => job.endHours === end), farmReservations)) return;
        visit(end, advanced, started.filter(job => job.endHours > end), released, [...jobs, ...started.filter(job => !running.includes(job))]);
        return;
      }
      const job = ready[index];
      // Defer this chain until another campaign releases its workers.
      dispatch(index + 1, reserved, started, advanced);
      const crew = counts();
      function assign(typeIndex, slots, power) {
        if (!exhausted) return;
        if (typeIndex === positive.length) {
          if (!(power > 0)) return;
          const endHours = time + Math.max(MIN_HOURS, job.work / power);
          if (endHours >= best.totalHours) return;
          const launched = { ...job, workers: { ...crew }, startHours: time, endHours, alreadyRunning: false };
          const remaining = counts(reserved);
          TYPE_ORDER.forEach(type => { remaining[type] -= crew[type]; });
          const following = [...advanced]; following[job.chain]++;
          dispatch(index + 1, remaining, [...started, launched], following);
          return;
        }
        const type = positive[typeIndex];
        for (let count = 0; count <= Math.min(slots, reserved[type]); count++) {
          crew[type] = count;
          assign(typeIndex + 1, slots - count, power + count * workers[type].power);
        }
        crew[type] = 0;
      }
      assign(0, job.cap, 0);
    }
    dispatch(0, free, running, next);
  }
  const free = counts(available);
  initialJobs.forEach(job => TYPE_ORDER.forEach(type => { free[type] -= job.workers[type]; }));
  const next = chains.map((_, chain) => initialJobs.some(job => job.chain === chain) ? 1 : 0);
  visit(0, next, initialJobs, free, initialJobs);
  // Unlocking a farm permanently consumes capacity. A delayed launch between
  // completion events can postpone that commitment, so event-only enumeration
  // is not an exhaustive optimality proof when future farms are required.
  return { ...best, exhausted: exhausted && !Object.values(farmReservations).some(rows => rows.length), nodes };
}
