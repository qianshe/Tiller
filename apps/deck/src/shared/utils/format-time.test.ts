import assert from "node:assert/strict";
import test from "node:test";
import {
  deckLocale,
  formatDeviceTime,
  formatRelativeTime,
  formatSessionTime,
} from "./format-time.js";

test("formatRelativeTime returns the original value for invalid dates", () => {
  assert.equal(formatRelativeTime("not-a-date"), "not-a-date");
});

test("formatRelativeTime renders minute, hour, and day buckets", () => {
  const now = Date.now;
  Date.now = () => Date.parse("2026-05-04T12:00:00.000Z");
  try {
    assert.equal(formatRelativeTime("2026-05-04T11:59:00.000Z"), "1m");
    assert.equal(formatRelativeTime("2026-05-04T10:00:00.000Z"), "2h");
    assert.equal(formatRelativeTime("2026-05-02T12:00:00.000Z"), "2d");
  } finally {
    Date.now = now;
  }
});

test("session and device time formatters fall back for invalid dates", () => {
  assert.equal(formatSessionTime("bad"), "bad");
  assert.equal(formatDeviceTime("bad"), "bad");
});

test("deckLocale reads document language and falls back to zh-CN", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    documentElement: { lang: "en-US" },
  } as unknown as Document;
  try {
    assert.equal(deckLocale(), "en-US");
    globalThis.document = { documentElement: { lang: "" } } as unknown as Document;
    assert.equal(deckLocale(), "zh-CN");
  } finally {
    globalThis.document = previousDocument;
  }
});
