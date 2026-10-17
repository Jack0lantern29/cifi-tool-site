import { TYPE_ORDER } from "./data.js?v=3.2.7";

// Independent replay: do not reuse dispatch or farm-horizon helpers here.
// A valid plan must account for every crew at every launch and collection.
export function shortsScheduleErrors(chains, initialJobs, available, workers, plan, farmReservations = {}, awayHours = 0) {
  const errors = [];
  const jobs = new Map(plan.jobs.map(job => [job.name, job]));
  const expected = chains.flat();
  const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8;
  if (jobs.size !== plan.jobs.length || jobs.size !== expected.length || expected.some(job => !jobs.has(job.name))) errors.push("Missing or duplicate campaign missions.");
  for (const chain of chains) for (let index = 0; index < chain.length; index++) {
    const source = chain[index], job = jobs.get(source.name);
    if (!job) continue;
    if (!job.workers || TYPE_ORDER.some(type => !Number.isSafeInteger(job.workers[type]) || job.workers[type] < 0)) { errors.push(`${job.name}: invalid crew.`); continue; }
    const count = TYPE_ORDER.reduce((total, type) => total + job.workers[type], 0);
    if (!count || count > source.cap) errors.push(`${job.name}: crew exceeds cap or is empty.`);
    if (![job.startHours, job.finishHours, job.endHours].every(Number.isFinite) || job.startHours < 0 || job.finishHours < job.startHours || job.endHours < job.finishHours) errors.push(`${job.name}: invalid times.`);
    if (job.startHours > 0 && job.startHours < awayHours) errors.push(`${job.name}: launch during absence.`);
    if (!close(job.endHours, Math.max(job.finishHours, awayHours))) errors.push(`${job.name}: premature collection.`);
    const active = initialJobs.find(item => item.name === job.name);
    if (active) {
      if (!job.alreadyRunning || job.startHours !== 0 || !close(job.finishHours, active.finishHours) || TYPE_ORDER.some(type => job.workers[type] !== active.workers[type])) errors.push(`${job.name}: changed running mission.`);
    } else {
      const power = TYPE_ORDER.reduce((total, type) => total + job.workers[type] * workers[type].power, 0);
      if (job.alreadyRunning || !(power > 0) || !close(job.finishHours - job.startHours, Math.max(2 / 3600, source.work / power))) errors.push(`${job.name}: incorrect duration.`);
    }
    for (const name of [chain[index - 1]?.name, source.prerequisite].filter(Boolean)) {
      if (!jobs.has(name) || jobs.get(name).endHours > job.startHours + 1e-8) errors.push(`${job.name}: predecessor ${name} not collected.`);
    }
  }
  const times = [...new Set(plan.jobs.flatMap(job => [job.startHours, job.endHours]))];
  for (const time of times) for (const type of TYPE_ORDER) {
    const running = plan.jobs.filter(job => job.startHours <= time && job.endHours > time).reduce((total, job) => total + (job.workers?.[type] ?? Infinity), 0);
    const farms = plan.jobs.filter(job => job.endHours <= time).reduce((total, job) => total + (farmReservations[job.name] || []).filter(row => row.type === type).reduce((value, row) => value + row.count, 0), 0);
    if (running + farms > available[type]) errors.push(`${type}: overallocated at hour ${time}.`);
  }
  if (!close(plan.totalHours, Math.max(0, ...plan.jobs.map(job => job.endHours)))) errors.push("Incorrect final completion time.");
  return errors;
}
