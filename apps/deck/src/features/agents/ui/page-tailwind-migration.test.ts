import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const agentsRoot = resolve(currentDir, "..");

function readUiFile(fileName: string): string {
  return readFileSync(resolve(currentDir, fileName), "utf8");
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      return listFiles(path);
    }
    return [".tsx", ".css"].includes(extname(path)) ? [path] : [];
  });
}

test("agents overview layout uses shared UI and Tailwind classes", () => {
  const page = readUiFile("page.tsx");
  const agentsTree = readUiFile("agents-tree.tsx");
  const helmDetail = readUiFile("helm-detail-section.tsx");

  assert.match(page, /agents-fleet-shell/);
  assert.match(page, /<AgentsTree/);
  assert.match(page, /DeleteHelmConfigDialog/);
  assert.match(page, /min-h-0 min-w-0 overflow-hidden/);
  assert.doesNotMatch(page, /wb-pane flex min-h-0 min-w-0 flex-col overflow-hidden/);
  assert.match(agentsTree, /settings-section-nav|agents-helm-tree/);
  assert.match(agentsTree, /StatusDot/);
  assert.match(helmDetail, /import \{ AgentIcon, Badge, Button, Icon, StatusDot \} from "@\/shared\/ui"/);
  assert.match(helmDetail, /Agents \(\$\{selectedHelmAgents.length\}\)/);
  assert.match(helmDetail, /h-full min-h-0/);
  assert.match(helmDetail, /wb-pane-sunken/);
});

test("agents feature no longer depends on feature CSS class hooks", () => {
  const source = listFiles(agentsRoot)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");

  for (const legacyClass of [
    "fleet-command-panel",
    "fleet-title-row",
    "fleet-hub",
    "fleet-hub-head",
    "fleet-hub-node",
    "fleet-modal-backdrop",
    "fleet-dialog",
    "fleet-delete",
    "helm-status-dot",
    "helm-detail-panel",
    "helm-detail-facts",
    "helm-inventory-list-section",
    "helm-simple-list",
    "helm-beacon",
    "empty-state",
  ]) {
    assert.doesNotMatch(source, new RegExp(`className=[^\\n]*${legacyClass}`));
  }
});

test("project and agent inventory expose edit and delete RPC actions", () => {
  const projectInventory = readUiFile("project-inventory-section.tsx");
  const agentInventory = readUiFile("agent-inventory-section.tsx");

  assert.match(projectInventory, /aria-label=\{`编辑项目/);
  assert.match(projectInventory, /aria-label=\{`删除项目/);
  assert.match(projectInventory, /"project\/delete"/);
  assert.match(agentInventory, /aria-label=\{`编辑 ACP/);
  assert.match(agentInventory, /aria-label=\{`删除 ACP/);
  assert.match(agentInventory, /"agent\/delete"/);
});

test("fleet project detail favors worktree and hides branch and default agent", () => {
  const helmDetail = readUiFile("helm-detail-section.tsx");
  const projectInventory = readUiFile("project-inventory-section.tsx");

  assert.doesNotMatch(helmDetail, />\s*分支\s*</);
  assert.doesNotMatch(projectInventory, />\s*默认分支\s*</);
  assert.doesNotMatch(projectInventory, />\s*Default Agent\s*</);
  assert.match(projectInventory, />Git Branch</);
  assert.match(projectInventory, />Worktrees</);
  assert.match(projectInventory, /resolveProjectWorktrees/);
});
