import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import { createSessionRuntimeEventState } from "../../runtime/session/event/runtime-state";
import { createSession } from "./session-create-rpc";

test("new session stores the config confirmed by the ACP runtime", async () => {
  const stored: SessionSummary[] = [];
  const runtimeOptions = [
    {
      id: "model",
      category: "model",
      currentValue: "default",
      options: [
        { value: "default", label: "Default" },
        { value: "opus", label: "Opus" },
      ],
    },
    {
      id: "thought_level",
      category: "thought_level",
      currentValue: "medium",
      options: [{ value: "medium", label: "Medium" }],
    },
  ];
  const project = { id: "project-1", name: "Tiller", helmId: "helm-1" };
  const helm = { id: "helm-1", name: "Local" };
  const worktree = { name: "main", path: "D:/repo" };
  const agent = {
    id: "claude-code",
    name: "Claude Code",
    command: "claude-code",
    transport: "stdio",
    protocol: "acp",
  };
  const context = {
    loadAvailableHelms: () => [helm],
    loadAvailableWorktrees: () => [worktree],
    loadAvailableAgents: () => [agent],
    setHelms: () => undefined,
    setWorktrees: () => undefined,
    setAgents: () => undefined,
    loadAvailableProjectsWithSemanticSummaries: async () => [project],
    setProjects: () => undefined,
    resolveProjectById: () => project,
    resolveProviderById: () => agent,
    resolveHelmById: () => helm,
    sessionStore: {
      upsert: (summary: SessionSummary) => stored.push(summary),
    },
    sessions: new Map(),
    buildResumeInfo: () => undefined,
    persistRuntimeDescriptor: () => undefined,
    broadcastNotification: () => undefined,
    broadcastSessionTopic: () => undefined,
    createRuntime: async (params: any) => {
      assert.deepEqual(params.sessionConfig, {
        agentMode: "plan",
        model: "opus",
        reasoningEffort: "high",
      });
      return {
        runtimeSessionId: "runtime-1",
        sessionCapabilities: { sessionResume: true },
        sessionConfigState: {
          agentMode: "runtime-mode",
          model: "default",
          reasoningEffort: "medium",
        },
        sessionConfigOptions: runtimeOptions,
        sessionModelState: {
          currentModelId: "default",
          options: [
            { id: "default", name: "Default" },
            { id: "opus", name: "Opus" },
          ],
        },
      };
    },
    handleRuntimeEvent: () => undefined,
    hydrateSessionSummary: (summary: SessionSummary) => summary,
    sessionRuntimeEventState: createSessionRuntimeEventState(),
    logInfo: () => undefined,
    logError: () => undefined,
  } as any;

  const result = await createSession(
    {
      projectId: project.id,
      cwd: worktree.path,
      agentId: agent.id,
      agentMode: "plan",
      model: "opus",
      reasoningEffort: "high",
    },
    context,
  );

  assert.equal(result.session.agentMode, "runtime-mode");
  assert.equal(result.session.model, "default");
  assert.equal(result.session.reasoningEffort, "medium");
  assert.equal(stored.at(-1)?.agentMode, "runtime-mode");
  assert.equal(stored.at(-1)?.model, "default");
  assert.equal(stored.at(-1)?.reasoningEffort, "medium");
});
