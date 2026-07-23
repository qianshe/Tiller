import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const rootSource = readFileSync(join(currentDir, "root.tsx"), "utf8");

test("app shell keeps approval toast overlay but does not mount global approval panel", () => {
  assert.match(rootSource, /ApprovalToastStackContainer/);
  assert.doesNotMatch(rootSource, /GlobalApprovalPanelContainer/);
});

test("app shell drives slash command context from the focused composer session", () => {
  assert.match(rootSource, /const composerSlashSession = missionView\.selectedComposerSession \?\? missionView\.activeSession;/);
  assert.match(rootSource, /activeSessionId: composerSlashSession\?\.id \?\? deckData\.activeSessionId/);
  assert.match(rootSource, /activeSessionAgentId: composerSlashSession\?\.agentId \?\? runtimeState\.selectedAgentId/);
});
