// Completion and collection are separate: an absent player cannot reuse a
// finished crew or launch a newly unlocked mission until they return.
export function campaignTiming(startHours, durationHours, awayHours = 0) {
  const finishHours = startHours + durationHours;
  return { finishHours, endHours: Math.max(finishHours, awayHours) };
}

export function awayHoursRemaining(input, now = Date.now()) {
  return input.awayEnabled ? Math.max(0, (input.awayUntil - now) / 3600000) : 0;
}

export function localDateTimeValue(timestamp) {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
