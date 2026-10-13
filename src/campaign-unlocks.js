export const SECTION_REQUIREMENTS = Object.freeze({
  C2: { section: "C1", stage: 8 },
  C3: { section: "C2", stage: 8 }
});

// Include the required path without changing the user's saved target choices.
export function includeCampaignPrerequisites(progress) {
  const expanded = Object.fromEntries(Object.entries(progress).map(([section, value]) => [section, { ...value }]));
  for (const section of ["C3", "C2"]) {
    const entry = expanded[section];
    const required = SECTION_REQUIREMENTS[section];
    if (entry.completed === 0 && entry.target > 0) {
      const prior = expanded[required.section];
      if (prior.completed < required.stage) prior.target = Math.max(prior.target, required.stage);
    }
  }
  return expanded;
}

export function campaignPrerequisite(name, progress) {
  const [section, stage] = name.split("-");
  const required = SECTION_REQUIREMENTS[section];
  return stage === "1" && required && progress[required.section].completed < required.stage
    ? `${required.section}-${required.stage}` : null;
}

export function isCampaignReady(job, jobs, timeHours) {
  return !job.prerequisite || jobs.some(prior => prior.name === job.prerequisite && prior.endHours <= timeHours);
}
