import assert from "node:assert/strict";
import test from "node:test";
import { etaTimestamp, formatLocalETA } from "../src/eta.js";

test("ETAs use one fixed start time, include dates, and round up fractional seconds", () => {
  const start = Date.parse("2026-12-31T23:30:00Z");
  assert.equal(etaTimestamp(start, 1), Date.parse("2027-01-01T00:30:00Z"));
  assert.equal(etaTimestamp(start, 0.1 / 3600), start + 1000);
  const text = formatLocalETA(start, 1, { locale: "en-GB", timeZone: "UTC" });
  assert.match(text, /01 Jan 2027/);
  assert.match(text, /00:30:00/);
  assert.doesNotMatch(text, /GMT|UTC/);
});

test("ETAs reflect timezone and daylight-saving transitions", () => {
  const start = Date.parse("2026-10-03T15:30:00Z");
  const options = { locale: "en-GB", timeZone: "Australia/Sydney" };
  assert.match(formatLocalETA(start, 0, options), /01:30:00/);
  assert.match(formatLocalETA(start, 1, options), /03:30:00/);
  assert.match(formatLocalETA(start, 1, options), /04 Oct 2026/);
});

test("blocked, negative and out-of-range durations cannot produce misleading dates", () => {
  for (const hours of [Infinity, NaN, -1, Number.MAX_VALUE]) {
    assert.equal(etaTimestamp(Date.now(), hours), null);
    assert.equal(formatLocalETA(Date.now(), hours), "—");
  }
  assert.equal(etaTimestamp(NaN, 1), null);
});
