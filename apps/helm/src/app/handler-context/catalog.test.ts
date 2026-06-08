import assert from "node:assert/strict";
import test from "node:test";
import { createHandlerCatalogContext } from "./catalog";
import { createHelmContextState } from "../server/context";

test("handler catalog context groups inventory accessors and registry persistence", () => {
  const saved: unknown[] = [];
  const contextState = createHelmContextState({
    helms: [{ id: "local" }],
    worktrees: [{ id: "wt-1" }],
    agents: [{ id: "codex" }],
    projects: [{ id: "project-1" }],
  });
  const context = createHandlerCatalogContext({
    configPath: "D:/tiller/config.json",
    contextState,
    loadAvailableHelms: () => [{ id: "remote" }],
    loadAvailableWorktrees: () => [{ id: "wt-2" }],
    listAvailableProviders: (configPath) => [{ id: configPath }],
    loadAvailableProjectsWithSemanticSummaries: async () => [{ id: "project-2" }],
    readApprovalPolicy: (configPath) => ({ rules: [{ id: configPath }] }),
    saveApprovalPolicyRule: (rule, configPath) => saved.push({ rule, configPath }),
  });

  assert.deepEqual(context.getHelms(), [{ id: "local" }]);
  context.setHelms([{ id: "updated" }]);
  assert.deepEqual(context.getHelms(), [{ id: "updated" }]);
  assert.deepEqual(context.loadAvailableHelms(), [{ id: "remote" }]);
  assert.deepEqual(context.loadAvailableAgents(), [{ id: "D:/tiller/config.json" }]);
  assert.deepEqual(context.readApprovalPolicy(), {
    rules: [{ id: "D:/tiller/config.json" }],
  });

  context.saveApprovalPolicyRule({ id: "allow", action: "allow" } as any);

  assert.deepEqual(saved, [
    {
      rule: { id: "allow", action: "allow" },
      configPath: "D:/tiller/config.json",
    },
  ]);
});
