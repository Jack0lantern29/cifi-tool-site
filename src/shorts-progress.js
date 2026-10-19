import { CAMPAIGN_SECTIONS } from "./validation.js?v=3.2.8";

// Capture progress immediately after completions, before this step's new launches.
export function progressAtShortsStep(progress, plan, timeHours) {
  return Object.fromEntries(CAMPAIGN_SECTIONS.map(section => {
    const finished = plan.jobs.filter(job => job.section === section && job.endHours <= timeHours);
    const completed = Math.max(progress[section].completed, ...finished.map(job => Number(job.name.split("-")[1])));
    const running = plan.jobs.find(job => job.section === section && (job.startHours < timeHours || job.alreadyRunning) && job.endHours > timeHours);
    return [section, {
      completed, target: progress[section].target,
      active: running ? { remainingHours: (running.finishHours ?? running.endHours) - timeHours, workers: { ...running.workers } } : null
    }];
  }));
}
