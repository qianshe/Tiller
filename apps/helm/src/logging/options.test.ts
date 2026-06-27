import assert from "node:assert/strict";
import test from "node:test";
import { resolveLoggingOptions } from "./options";

test("defaults to normal info logging with ACP summary trace", () => {
  assert.deepEqual(resolveLoggingOptions({}), {
    level: "info",
    format: "json",
    acpTrace: "summary",
  });
});

test("TILLER_DEBUG enables debug level", () => {
  assert.equal(resolveLoggingOptions({ TILLER_DEBUG: "1" }).level, "debug");
});

test("TILLER_LOG_LEVEL overrides TILLER_DEBUG", () => {
  assert.equal(
    resolveLoggingOptions({ TILLER_DEBUG: "1", TILLER_LOG_LEVEL: "warn" }).level,
    "warn",
  );
});

test("invalid log level falls back to info", () => {
  assert.equal(resolveLoggingOptions({ TILLER_LOG_LEVEL: "verbose" }).level, "info");
});

test("pretty format is explicit", () => {
  assert.equal(resolveLoggingOptions({ TILLER_LOG_FORMAT: "pretty" }).format, "pretty");
});

test("ACP trace supports off, summary, and raw", () => {
  assert.equal(resolveLoggingOptions({ TILLER_ACP_TRACE: "off" }).acpTrace, "off");
  assert.equal(resolveLoggingOptions({ TILLER_ACP_TRACE: "summary" }).acpTrace, "summary");
  assert.equal(resolveLoggingOptions({ TILLER_ACP_TRACE: "raw" }).acpTrace, "raw");
});

test("TILLER_LOG_LEVEL supports Pino-compatible fatal and trace levels", () => {
  assert.equal(resolveLoggingOptions({ TILLER_LOG_LEVEL: "fatal" }).level, "fatal");
  assert.equal(resolveLoggingOptions({ TILLER_LOG_LEVEL: "trace" }).level, "trace");
});

test("config file logging options apply when env is unset", () => {
  assert.deepEqual(
    resolveLoggingOptions({}, { level: "warn", format: "pretty", acpTrace: "off" }),
    { level: "warn", format: "pretty", acpTrace: "off" },
  );
});

test("env logging options override config file logging options", () => {
  assert.deepEqual(
    resolveLoggingOptions(
      { TILLER_LOG_LEVEL: "debug", TILLER_LOG_FORMAT: "json", TILLER_ACP_TRACE: "raw" },
      { level: "warn", format: "pretty", acpTrace: "off" },
    ),
    { level: "debug", format: "json", acpTrace: "raw" },
  );
});

test("TILLER_DEBUG overrides config log level", () => {
  assert.equal(resolveLoggingOptions({ TILLER_DEBUG: "1" }, { level: "warn" }).level, "debug");
});
