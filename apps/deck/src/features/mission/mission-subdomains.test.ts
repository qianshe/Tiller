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

  for (const internalImport of ["./chat-pane", "./composer", "./diff-panel", "./display-section", "./inspector", "./sidebar"] as const) {
    assert.doesNotMatch(workspaceSource, new RegExp(`from "${internalImport.replace(".", "\\\\.")}"`));
  }
});

test("mission workspace implementation lives in the workspace subdomain", () => {
  for (const filename of ["workspace.tsx", "workspace-model.ts", "workspace-runtime-overview.ts"] as const) {
    assert.equal(existsSync(join(missionRoot, "workspace", filename)), true, `workspace/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});

test("mission composer implementation lives in the composer subdomain", () => {
  for (const filename of [
    "composer.tsx",
    "composer.test.tsx",
    "composer-attachments.tsx",
    "composer-config-controls.tsx",
    "composer-draft-selectors.tsx",
    "slash-command-popup.tsx",
    "slash-command-popup.test.tsx",
  ] as const) {
    assert.equal(existsSync(join(missionRoot, "composer", filename)), true, `composer/${filename} should exist`);
    assert.equal(existsSync(join(missionRoot, "ui", filename)), false, `ui/${filename} should be moved out`);
  }
});
