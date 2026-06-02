import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootSource = readFileSync(resolve(currentDir, "root.tsx"), "utf8");

test("logging settings use the selected Helm RPC client before the default connection", () => {
  assert.match(rootSource, /function resolveLoggingTarget\(\)/);
  assert.match(rootSource, /deckData\.selectedHelmKey/);
  assert.match(rootSource, /function resolveCandidateHelmIds\(\)/);
  assert.match(rootSource, /runtimeState\.helmRpcClientRefs\.current\.get\(helmId\)/);
  assert.match(rootSource, /directClient\?\.socket\.readyState === WebSocket\.OPEN/);
  assert.match(rootSource, /for \(const \[helmKey, client\] of runtimeState\.helmRpcClientRefs\.current\)/);
  assert.match(rootSource, /function resolveLoggingClient\(\)/);
  assert.match(rootSource, /loggingClientAvailable/);
  assert.match(rootSource, /loggingConnectionKnownConnected/);
  assert.match(rootSource, /Object\.values\(deckData\.helmConnectionStates\)\.includes\("connected"\)/);
  assert.match(rootSource, /deckData\.helmConnectionStates/);
});

test("logging settings prefer current local RPC results over stale Helm inventory", () => {
  assert.match(rootSource, /function resolveSyncedLoggingSettings\(\)/);
  assert.match(rootSource, /type LocalLoggingSettings =/);
  assert.match(rootSource, /deckData\.helmInventories\[helmId\]\?\.logging/);
  assert.match(rootSource, /normalizeLoggingSettings\(\{ logging \}\)/);
  assert.match(rootSource, /function resolveLocalLoggingSettings\(\)/);
  assert.match(rootSource, /resolveCandidateHelmIds\(\)\.includes\(localLoggingSettings\.helmKey\)/);
  assert.match(rootSource, /setLocalLoggingSettings\(\{ helmKey: target\.helmKey, settings: next \}\);/);
  assert.match(rootSource, /const currentLoggingSettings = resolveLocalLoggingSettings\(\);/);
  assert.match(rootSource, /const syncedLoggingSettings = resolveSyncedLoggingSettings\(\);/);
  assert.match(rootSource, /const effectiveLoggingSettings = currentLoggingSettings \?\? syncedLoggingSettings;/);
  assert.match(rootSource, /loggingSettings: effectiveLoggingSettings/);
  assert.match(rootSource, /deckData\.applyHelmInventory\(target\.helmKey, \{ logging: next \}\);/);
  assert.doesNotMatch(rootSource, /当前：\$\{next\.level\}/);
});
