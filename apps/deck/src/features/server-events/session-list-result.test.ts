import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import {
  deriveSessionListResult,
  mergeSessionLifecycleSummary,
} from "./session-list-result.js";

function session(overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "updatedAt">): SessionSummary {
  return {
    title: overrides.id,
    agentId: "codex",
    agentName: "Codex",
    projectId: "project-1",
    projectName: "Tiller",
    cwd: "D:/myProject/tools/Tiller",
    status: "idle",
    createdAt: "2026-05-29T00:00:00.000Z",
    ...overrides,
  } as SessionSummary;
}

test("deriveSessionListResult replaces sessions for an initial list response", () => {
  const result = deriveSessionListResult({
    currentSessions: [session({ id: "old", updatedAt: "2026-05-29T00:00:00.000Z" })],
    payload: {
      sessions: [session({ id: "new", updatedAt: "2026-05-29T00:01:00.000Z", status: "running" })],
      nextCursor: "cursor-1",
      hasMore: true,
    },
  });

  assert.deepEqual(result.nextSessions.map((item) => item.id), ["new"]);
  assert.equal(result.nextStatuses.new, "running");
  assert.deepEqual(result.historyState, { nextCursor: "cursor-1", hasMore: true, loading: false });
});

test("deriveSessionListResult merges paged sessions and derives config and command maps", () => {
  const current = session({ id: "current", updatedAt: "2026-05-29T00:02:00.000Z" });
  const incoming = session({
    id: "incoming",
    updatedAt: "2026-05-29T00:01:00.000Z",
    configOptions: [{ id: "model", name: "Model", value: "gpt", options: [] }],
    availableCommands: [{ name: "test", description: "Run tests" }],
  });

  const result = deriveSessionListResult({
    currentSessions: [current],
    payload: { sessions: [incoming], before: true },
  });

  assert.deepEqual(result.nextSessions.map((item) => item.id), ["current", "incoming"]);
  assert.ok(result.configOptionsBySession.incoming);
  assert.deepEqual(result.availableCommands.bySession.incoming, incoming.availableCommands);
  assert.deepEqual(result.availableCommands.byAgent.codex, incoming.availableCommands);
});

test("deriveSessionListResult keeps listed lifecycle status over stale live details", () => {
  const result = deriveSessionListResult({
    currentSessions: [],
    liveStatesBySession: {
      resumed: {
        sequence: 42,
        status: {
          runtimeStatus: "idle",
          effectiveStatus: "idle",
          pendingApprovalCount: 0,
        },
      },
    },
    payload: {
      sessions: [session({
        id: "resumed",
        updatedAt: "2026-05-29T00:03:00.000Z",
        status: "starting",
      })],
    },
  });

  assert.equal(result.nextSessions[0]?.status, "starting");
  assert.equal(result.nextStatuses.resumed, "starting");
});

test("deriveSessionListResult keeps runtime-confirmed config over stale persisted selection", () => {
  const runtimeConfigOptions = [
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
  const result = deriveSessionListResult({
    currentSessions: [],
    liveStatesBySession: {
      resumed: {
        sequence: 43,
        config: {
          model: "default",
          reasoningEffort: "medium",
          configOptions: runtimeConfigOptions,
          modelOptions: [{ id: "default", name: "Default" }],
        },
      },
    },
    payload: {
      sessions: [session({
        id: "resumed",
        updatedAt: "2026-05-29T00:03:00.000Z",
        model: "opus",
        reasoningEffort: "high",
      })],
    },
  });

  assert.equal(result.nextSessions[0]?.model, "default");
  assert.equal(result.nextSessions[0]?.reasoningEffort, "medium");
  assert.deepEqual(result.nextSessions[0]?.configOptions, runtimeConfigOptions);
});

test("deriveSessionListResult preserves listed config when canonical config is uninitialized", () => {
  const configOptions = [
    {
      id: "model",
      name: "Model",
      category: "model",
      currentValue: "cpa-oai/gpt-5.5",
      options: [{ value: "cpa-oai/gpt-5.5", label: "GPT-5.5" }],
    },
  ];
  const result = deriveSessionListResult({
    currentSessions: [],
    liveStatesBySession: {
      resumed: {
        sequence: 1496,
        config: { configOptions: [], modelOptions: [] },
      },
    },
    payload: {
      sessions: [session({
        id: "resumed",
        updatedAt: "2026-07-13T15:15:45.133Z",
        model: "cpa-oai/gpt-5.5",
        configOptions,
      })],
    },
  });

  assert.equal(result.nextSessions[0]?.model, "cpa-oai/gpt-5.5");
  assert.deepEqual(result.nextSessions[0]?.configOptions, configOptions);
  assert.deepEqual(result.configOptionsBySession.resumed, configOptions);
});

test("mergeSessionLifecycleSummary keeps a saved title over an ACP session title", () => {
  const result = mergeSessionLifecycleSummary(
    session({ id: "renamed", title: "发布计划", updatedAt: "2026-05-29T00:03:00.000Z" }),
    {
      sequence: 44,
      sessionInfo: { title: "请检查发布计划" },
    },
  );

  assert.equal(result.title, "发布计划");
});

test("mergeSessionLifecycleSummary fills an unnamed session title from ACP", () => {
  const result = mergeSessionLifecycleSummary(
    session({ id: "unnamed", title: undefined, updatedAt: "2026-05-29T00:03:00.000Z" }),
    {
      sequence: 45,
      sessionInfo: { title: "请检查发布计划" },
    },
  );

  assert.equal(result.title, "请检查发布计划");
});
