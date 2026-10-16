import { farmUnlockCampaign, TYPE_ORDER } from "./data.js?v=3.2.5";

export function createFarmReservations(assignments) {
  const reservations = {};
  for (const assignment of assignments) {
    const unlock = farmUnlockCampaign(assignment.name);
    if (!reservations[unlock]) reservations[unlock] = [];
    reservations[unlock].push({ ...assignment });
  }
  return reservations;
}

export function reserveUnlockedFarms(free, finished, reservations) {
  const needed = Object.fromEntries(TYPE_ORDER.map(type => [type, 0]));
  finished.forEach(job => (reservations[job.name] || []).forEach(assignment => { needed[assignment.type] += assignment.count; }));
  if (TYPE_ORDER.some(type => needed[type] > free[type])) return false;
  TYPE_ORDER.forEach(type => { free[type] -= needed[type]; });
  return true;
}

// Check the entire known completion horizon, not just the workers free now.
// A launch may not lock workers past a farm unlock that needs those workers.
export function checkFarmReservationHorizon(free, running, candidate, reservations) {
  const remaining = { ...free };
  if (candidate) TYPE_ORDER.forEach(type => { remaining[type] -= candidate.workers[type]; });
  const scheduled = candidate ? [...running, candidate] : running;
  if (!scheduled.some(job => reservations[job.name]?.length)) return { feasible: true };
  const times = [...new Set(scheduled.map(job => job.endHours))].sort((a, b) => a - b);
  for (const time of times) {
    const finished = scheduled.filter(job => job.endHours === time);
    finished.forEach(job => TYPE_ORDER.forEach(type => { remaining[type] += job.workers[type]; }));
    finished.forEach(job => (reservations[job.name] || []).forEach(assignment => { remaining[assignment.type] -= assignment.count; }));
    if (TYPE_ORDER.some(type => remaining[type] < 0)) return { feasible: false, timeHours: time, remaining };
  }
  return { feasible: true };
}

export function farmEventsForJobs(jobs, reservations) {
  return jobs.flatMap(job => {
    const byFarm = new Map();
    (reservations[job.name] || []).forEach(assignment => {
      if (!byFarm.has(assignment.name)) byFarm.set(assignment.name, Object.fromEntries(TYPE_ORDER.map(type => [type, 0])));
      byFarm.get(assignment.name)[assignment.type] += assignment.count;
    });
    return [...byFarm].map(([name, workers]) => ({ name, workers, unlockCampaign: job.name, timeHours: job.endHours }));
  });
}
