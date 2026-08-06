import assert from "node:assert/strict";
import test from "node:test";
import { resolveHelmUpdateLifecycleDecision } from "./update-lifecycle";

const update = {
  status: "restarting" as const,
  currentVersion: "1.0.0",
  latestVersion: "1.1.0",
  targetVersion: "1.1.0",
  updateAvailable: false,
  canUpdate: true,
};

test("stale connected Helm enters recovery timeout handling", () => {
  assert.equal(
    resolveHelmUpdateLifecycleDecision({ connection: "connected", update }),
    "recover",
  );
});

test("connected Helm reloads only after confirming the target version", () => {
  assert.equal(
    resolveHelmUpdateLifecycleDecision({
      connection: "connected",
      update: { ...update, currentVersion: "1.1.0" },
    }),
    "reload",
  );
});
