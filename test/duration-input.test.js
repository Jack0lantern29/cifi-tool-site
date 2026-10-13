import assert from "node:assert/strict";
import test from "node:test";
import { parseRemainingTime, formatRemainingTime } from "../src/duration-input.js";

test("remaining time accepts HH:MM:SS including durations longer than a day", () => {
  assert.equal(parseRemainingTime("02:30:15"), 9015 / 3600);
  assert.equal(parseRemainingTime("125:59:59"), 453599 / 3600);
  assert.equal(parseRemainingTime("00:00:00"), 0);
  assert.equal(formatRemainingTime(25.5), "25:30:00");
  assert.equal(formatRemainingTime(0.5 / 3600), "00:00:01");
});

test("empty and malformed remaining times cannot silently become zero", () => {
  for (const value of ["", "1", "1.5", "12:30", "00:60:00", "00:00:60", "-01:00:00", "AA:BB:CC", "9999999999999999:00:00"]) {
    assert.ok(Number.isNaN(parseRemainingTime(value)), value);
  }
  assert.equal(formatRemainingTime(NaN), "");
  assert.equal(formatRemainingTime(-1), "");
});

test("saved numeric hours round-trip through the time field without gaining seconds", () => {
  for (let seconds = 0; seconds <= 172800; seconds++) {
    const hours = seconds / 3600;
    assert.equal(parseRemainingTime(formatRemainingTime(hours)), hours, `second ${seconds}`);
  }
});
