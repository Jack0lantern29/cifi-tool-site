// Use elapsed milliseconds so daylight-saving changes follow the device's clock.
export function etaTimestamp(startedAt, hours) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(hours) || hours < 0) return null;
  const timestamp = startedAt + Math.ceil(hours * 3600) * 1000;
  return Number.isFinite(new Date(timestamp).getTime()) ? timestamp : null;
}

export function formatLocalETA(startedAt, hours, { locale, timeZone } = {}) {
  const timestamp = etaTimestamp(startedAt, hours);
  if (timestamp == null) return "—";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    ...(timeZone ? { timeZone } : {})
  }).format(new Date(timestamp));
}
