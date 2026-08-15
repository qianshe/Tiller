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
  const dashboardWorkspace = readUiFile("dashboard-workspace.tsx");
  const helmDetail = readUiFile("helm-detail-section.tsx");

  assert.match(page, /agents-fleet-shell/);
  assert.match(page, /agents-fleet-shell agents-v6-page w-full min-w-0/);
  assert.match(page, /<AgentsTree/);
  assert.match(page, /mode = "standalone"/);
  assert.match(page, /<DashboardAgentsWorkspace/);
  assert.match(page, /DeleteHelmConfigDialog/);
  assert.match(page, /min-h-0 min-w-0 overflow-hidden/);
  assert.doesNotMatch(page, /wb-pane flex min-h-0 min-w-0 flex-col overflow-hidden/);
  assert.match(agentsTree, /settings-section-nav|agents-helm-tree/);
  assert.match(agentsTree, /StatusDot/);
  assert.match(agentsTree, /flex h-6 w-full items-center gap-1\.5 rounded px-1\.5/);
  assert.match(helmDetail, /font-mono text-2xs tabular text-foreground/);
  assert.match(helmDetail, /import \{ Badge, Button, Icon, StatusDot \} from "@\/shared\/ui"/);
  assert.doesNotMatch(helmDetail, /AgentIcon/);
  assert.match(helmDetail, /Agents \(\$\{selectedHelmAgents.length\}\)/);
  assert.match(helmDetail, /h-full min-h-0/);
  assert.match(helmDetail, /w-full min-w-0 flex-1/);
  assert.match(dashboardWorkspace, /h-full min-h-0/);
  assert.doesNotMatch(dashboardWorkspace, /h-screen/);
  assert.match(readUiFile("inventory-table.tsx"), /wb-pane-sunken/);
});

test("agents tab uses the shared inventory layout", () => {
  const helmDetail = readUiFile("helm-detail-section.tsx");

  assert.match(
    helmDetail,
    /activeTab === "agents" \? \(\s*<div className="grid gap-3">\s*<AgentInventorySection/s,
  );
  assert.doesNotMatch(helmDetail, /selectedHelmAgents\.map\(\(agent\) =>/);
  assert.doesNotMatch(helmDetail, /注册新 ACP Agent/);
});

test("helm inventory tabs share the inventory table UI", () => {
  const helmDetail = readUiFile("helm-detail-section.tsx");
  const agentInventory = readUiFile("agent-inventory-section.tsx");
  const projectInventory = readUiFile("project-inventory-section.tsx");
  const trustedDevices = readUiFile("trusted-devices-panel.tsx");
  const inventoryTable = readUiFile("inventory-table.tsx");

  assert.match(inventoryTable, /export function InventoryTable/);
  assert.match(agentInventory, /<InventoryTable/);
  assert.match(projectInventory, /<InventoryTable/);
  assert.match(trustedDevices, /<InventoryTable/);
  assert.match(helmDetail, /<InventoryTable/);
  assert.doesNotMatch(helmDetail, /<article key=\{worktree\.path\}/);
  const worktreesTab = helmDetail.indexOf('{ id: "worktrees", label: `工作区');
  const devicesTab = helmDetail.indexOf('{ id: "devices", label: `可信设备');
  assert.ok(worktreesTab >= 0 && devicesTab >= 0 && worktreesTab < devicesTab);
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
  assert.match(agentInventory, /AgentIcon/);
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
