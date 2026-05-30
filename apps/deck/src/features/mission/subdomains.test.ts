import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const missionRoot = fileURLToPath(new URL(".", import.meta.url));

const expectedSubdomains = [
  "workspace",
  "composer",
  "conversation",
  "display",
  "inspector",
  "navigation",
] as const;

test("mission feature exposes documented subdomain entrypoints", () => {
  for (const subdomain of expectedSubdomains) {
    const indexPath = join(missionRoot, subdomain, "index.ts");
    assert.equal(existsSync(indexPath), true, `${subdomain}/index.ts should exist`);
  }
});

test("mission root re-exports subdomain public APIs", () => {
  const indexSource = readFileSync(join(missionRoot, "index.ts"), "utf8");

  for (const subdomain of expectedSubdomains) {
    assert.match(indexSource, new RegExp(`export \\* from "\\./${subdomain}";`));
  }
});

test("mission workspace composes panes through subdomain entrypoints", () => {
  const workspaceSource = readFileSync(join(missionRoot, "workspace", "workspace.tsx"), "utf8");

  for (const subdomain of ["conversation", "composer", "display", "inspector", "navigation"] as const) {
    assert.match(workspaceSource, new RegExp(`from "\\.\\./${subdomain}"`));
  }

  for (const internalImport of ["./chat-pane", "./composer", "./diff-panel", "./section", "./inspector", "./sidebar"] as const) {
    assert.doesNotMatch(workspaceSource, new RegExp(`from "${internalImport.replace(".", "\\\\.")}"`));
  }
});

test("mission workspace implementation lives in the workspace subdomain", () => {
  for (const filename of ["workspace.tsx", "model.ts", "runtime-overview-dedupe.ts"] as const) {
    assert.equal(existsSync(join(missionRoot, "workspace", filename)), true, `workspace/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission composer implementation lives in the composer subdomain", () => {
  for (const filename of [
    "composer.tsx",
    "component.test.tsx",
    "attachments.tsx",
    "config-controls.tsx",
    "draft-selectors.tsx",
    "mission-status-bar.tsx",
    "mission-status-bar.test.tsx",
    "slash-command-popup.tsx",
    "slash-command-popup.test.tsx",
  ] as const) {
    assert.equal(existsSync(join(missionRoot, "composer", filename)), true, `composer/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission conversation implementation lives in the conversation subdomain", () => {
  for (const filename of [
    "chat-pane.tsx",
    "message-timeline.tsx",
    "plain-messages.test.ts",
    "plain-messages.tsx",
    "plain-messages.test.tsx",
    "permission-drawer.tsx",
    "permission-drawer.test.tsx",
    "queued-prompts.tsx",
    "queued-prompts.test.tsx",
    "session-approval-list.test.tsx",
    "tool-loading.tsx",
    "tool-loading.test.tsx",
  ] as const) {
    assert.equal(existsSync(join(missionRoot, "conversation", filename)), true, `conversation/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission display implementation lives in the display subdomain", () => {
  for (const filename of [
    "diff-panel.tsx",
    "diff-tree.tsx",
    "diff-tree.test.tsx",
    "panel.tsx",
    "panel.test.tsx",
    "section.tsx",
    "logbook-panel.tsx",
    "panels.ts",
    "session-overview-card.tsx",
    "session-overview-card.test.tsx",
  ] as const) {
    assert.equal(existsSync(join(missionRoot, "display", filename)), true, `display/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission inspector implementation lives in the inspector subdomain", () => {
  for (const filename of ["inspector.tsx", "panel-header.tsx"] as const) {
    assert.equal(existsSync(join(missionRoot, "inspector", filename)), true, `inspector/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission navigation implementation lives in the navigation subdomain", () => {
  for (const filename of [
    "agent-icon.tsx",
    "session-row.tsx",
    "sidebar-project-node.tsx",
    "sidebar.tsx",
  ] as const) {
    assert.equal(existsSync(join(missionRoot, "navigation", filename)), true, `navigation/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission ui folder keeps only shared shell/dialog primitives", () => {
  for (const filename of [
    "pane-resizer.tsx",
    "panels.tsx",
    "project-file-list.tsx",
    "session-cleanup-dialog.tsx",
  ] as const) {
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `obsolete ui/${filename} should not exist`);
  }
});
