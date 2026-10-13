// Keep saved and optimizer durations in hours; show editable durations as HH:MM:SS.
export const DURATION_PATTERN = "[0-9]+:[0-5][0-9]:[0-5][0-9]";

export function parseRemainingTime(value) {
  const match = /^([0-9]+):([0-5][0-9]):([0-5][0-9])$/.exec(String(value).trim());
  if (!match) return NaN;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) ? seconds / 3600 : NaN;
}

export function formatRemainingTime(hours) {
  if (!Number.isFinite(hours) || hours < 0) return "";
  const rawSeconds = hours * 3600;
  // Remove floating-point noise when converting saved whole seconds back from hours.
  const seconds = Math.ceil(rawSeconds - Number.EPSILON * rawSeconds);
  if (!Number.isSafeInteger(seconds)) return "";
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}
