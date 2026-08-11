import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "dialog.tsx"), "utf8");

test("quick create uses a modal with project-to-Helm-to-agent selection", () => {
  assert.match(source, /DialogTitle/);
  assert.match(source, /Textarea/);
  assert.match(source, /选择项目/);
  assert.match(source, /selectedHelm\.name/);
  assert.match(source, /selectedHelm\?\.agents/);
  assert.match(source, /agentId/);
  assert.match(source, /projectId: selectedProject\?\.projectId \?\? null/);
  assert.match(source, /const helmKey = selectedHelmKey/);
});

test("quick create resets the agent when the project changes", () => {
  assert.match(source, /setSelectedAgentId\(""\)/);
  assert.match(source, /onValueChange=\{handleProjectChange\}/);
});

test("quick create uses a prompt canvas with a compact target dock", () => {
  assert.match(source, /data-slot="dashboard-quick-create-prompt-canvas"/);
  assert.match(source, /data-slot="dashboard-quick-create-target-dock"/);
  assert.match(source, /告诉 Agent 需要完成什么/);
  assert.match(source, /selectedHelm\.name/);
  assert.match(source, /创建任务/);
  assert.doesNotMatch(source, />Prompt<\/Label>/);
});

test("quick create scopes projects and agents through an explicit Helm selector", () => {
  assert.match(source, /id="dashboard-quick-create-helm"/);
  assert.match(source, /projects\.filter\(\(project\) => project\.helmKey === selectedHelmKey\)/);
  assert.match(source, /helms\.map/);
  assert.match(source, /稍后选择项目/);
  assert.match(source, /稍后选择 Agent/);
  assert.match(source, /agentId: selectedAgent\?\.id \?\? null/);
});

test("quick create keeps the selected runtime visible beside the target selectors", () => {
  assert.match(source, /data-testid="dashboard-quick-create-runtime"/);
  assert.match(source, />\s*运行节点\s*<\/Label>/);
  assert.match(source, /selectedHelm\.name/);
  assert.match(source, /max-w-4xl/);
  assert.match(source, /lg:grid-cols-\[minmax\(0,1\.2fr\)_minmax\(0,1fr\)_minmax\(170px,0\.8fr\)_auto\]/);
});

test("quick create keeps selector icons and values on the same row", () => {
  assert.match(
    source,
    /data-slot="dashboard-quick-create-project-value"\s+className="flex min-w-0 items-center gap-2"/,
  );
  assert.match(
    source,
    /data-slot="dashboard-quick-create-agent-value"\s+className="flex min-w-0 items-center gap-2"/,
  );
});

test("quick create keeps selected target summaries compact", () => {
  const projectTrigger = source
    .split('id="dashboard-quick-create-project"')[1]
    ?.split("<SelectContent")[0] ?? "";
  assert.match(projectTrigger, /selectedProject\.name/);
  assert.match(projectTrigger, /selectedProject\.branch/);

  const runtimeCard = source
    .split('data-testid="dashboard-quick-create-runtime"')[1]
    ?.split("<Button")[0] ?? "";
  assert.doesNotMatch(runtimeCard, /helmEndpoint|helmKey/);
});

test("quick create identifies worktree targets by project and branch", () => {
  assert.match(source, /selectedProject\.name/);
  assert.match(source, /selectedProject\.branch/);
  assert.match(source, /project\.branch/);
});

test("quick create constrains long idle session labels without pushing the target controls", () => {
  const idleTrigger = source
    .split('id="dashboard-quick-create-idle-session"')[1]
    ?.split("</SelectTrigger>")[0] ?? "";

  assert.match(idleTrigger, /overflow-hidden/);
  assert.match(idleTrigger, /w-full min-w-0[\s\S]*overflow-hidden/);
  assert.match(idleTrigger, /min-w-0 flex-1 overflow-hidden/);
  assert.match(idleTrigger, /truncate/);
});

test("quick create can switch between a new session and reusing an idle session", () => {
  assert.match(source, /新建会话/);
  assert.match(source, /复用空闲会话/);
  assert.match(source, /selectedIdleSessionId/);
  assert.match(source, /selectedProject\?\.idleSessions/);
  assert.match(source, /sessionId: selectedIdleSession\.id/);
  assert.match(source, /mode: "reuse"/);
});

test("quick create accepts a prepared task preset and source record", () => {
  assert.match(source, /preset\?: DashboardQuickCreatePreset \| null\s*;/);
  assert.match(source, /presetProjectKey/);
  assert.match(source, /preset\?\.prompt\?\.trim\(\) \|\| preset\?\.title\?\.trim\(\)/);
  assert.match(source, /preparationId: preset\.preparationId/);
  assert.match(source, /title: preset\.title\.trim\(\)/);
  assert.match(source, /autoFocus=\{preset\?\.focusTarget === "project"\}/);
  assert.match(source, /autoFocus=\{preset\?\.focusTarget === "agent"\}/);
});
