import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveHelmUpdateLifecycleDecision } from "./update-lifecycle";

const source = readFileSync(fileURLToPath(new URL("./update-lifecycle.ts", import.meta.url)), "utf8");

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
    resolveHelmUpdateLifecycleDecision({
      connection: "connected",
      update,
      hasPendingUpdateIntent: true,
    }),
    "recover",
  );
});

test("connected Helm completes the update without reloading the Deck", () => {
  assert.equal(
    resolveHelmUpdateLifecycleDecision({
      connection: "connected",
      update: { ...update, currentVersion: "1.1.0" },
      hasPendingUpdateIntent: true,
    }),
    "complete",
  );
  assert.doesNotMatch(source, /location\.reload/);
});

test("ordinary reconnect does not reload for a stale restart state", () => {
  assert.equal(
    resolveHelmUpdateLifecycleDecision({
      connection: "connected",
      update: { ...update, currentVersion: "1.1.0" },
      hasPendingUpdateIntent: false,
    }),
    "idle",
  );
});
