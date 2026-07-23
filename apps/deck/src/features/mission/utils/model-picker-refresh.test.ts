import assert from "node:assert/strict";
import test from "node:test";
import { shouldRefreshModelPickerOptions } from "./model-picker-refresh.js";

test("refreshes only once for a given active runtime session", () => {
  assert.equal(
    shouldRefreshModelPickerOptions({
      activeSessionId: "s1",
      runtimeSessionId: "runtime-2",
      lastRefreshedRuntimeSessionId: undefined,
    }),
    true,
  );

  assert.equal(
    shouldRefreshModelPickerOptions({
      activeSessionId: "s1",
      runtimeSessionId: "runtime-2",
      lastRefreshedRuntimeSessionId: "runtime-2",
    }),
    false,
  );
});

test("does not refresh without an active runtime session", () => {
  assert.equal(
    shouldRefreshModelPickerOptions({
      activeSessionId: "s1",
      runtimeSessionId: undefined,
      lastRefreshedRuntimeSessionId: undefined,
    }),
    false,
  );

  assert.equal(
    shouldRefreshModelPickerOptions({
      activeSessionId: undefined,
      runtimeSessionId: "runtime-2",
      lastRefreshedRuntimeSessionId: undefined,
    }),
    false,
  );
});
