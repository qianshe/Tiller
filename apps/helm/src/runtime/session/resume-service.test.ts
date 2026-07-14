import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  AcpAgentProvider,
  SessionSummary,
  SessionTimelineEntry,
  WorktreeSummary,
} from "@tiller/shared";
import { createSessionResumeService } from "./resume-service.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "resume-service.ts"), "utf8");

test("restore discards ACP replay instead of rebuilding local history", () => {
  assert.doesNotMatch(source, /createRestoreReplayBuffer|providerHistory|acp_load_replay/u);
  assert.match(source, /onRestoreReplayEvent: \(\) => undefined/u);
});

test("session restore discards ACP load replay without mutating local display history", async () => {
  const sessionId = "session-opencode-restore";
  const agent: AcpAgentProvider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = {
    name: "main",
    path: "D:/repo",
  };
  const summary: SessionSummary = {
    id: sessionId,
    title: "测试效果",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "opencode",
    agentName: "OpenCode",
    cwd: "D:/repo",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    messageCount: 2,
    runtimeSessionId: "runtime-1",
  };
  let appliedSource = "";
  let appliedMessages: AgentMessage[] = [];
  const storedMessages: AgentMessage[] = [];
  const runtimeEvents: Array<{ type: string; status?: string }> = [];

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => [],
      replace: () => undefined,
    },
    sessionArtifactStore: {
      remove: () => undefined,
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "opencode",
        runtimeSessionId: "runtime-1",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async (input: any) => {
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "load-assistant-1",
            role: "assistant",
            text: "第一条回复",
            timestamp: "2026-05-28T00:00:30.000Z",
          },
        });
        return {
          runtimeSessionId: "runtime-1",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          cancel: () => undefined,
        };
      },
    },
    providerHistory: {
      hasHistoryContent: (history: { messages: unknown[] }) => history.messages.length > 0,
      applyAuthoritativeProviderHistory: (_sessionId: string, _agent: AcpAgentProvider, _runtimeSessionId: string, history: any) => {
        appliedSource = history.source;
        appliedMessages = history.messages;
      },
      refreshAuthoritativeSessionHistory: async () => undefined,
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: {
        append: (_sessionId: string, message: AgentMessage) => {
          storedMessages.push(message);
        },
      },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-05-28T00:00:00.000Z",
      runtimeSessionId: "runtime-1",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: (_sessionId: string, event: { type: string; status?: string }) => {
      runtimeEvents.push(event);
    },
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.equal(appliedSource, "");
  assert.deepEqual(appliedMessages, []);
  assert.deepEqual(storedMessages, []);
  assert.deepEqual(runtimeEvents, [{ type: "status", status: "idle" }]);
});

test("session restore does not reimport replayed ACP plan", async () => {
  const sessionId = "session-codex-plan-restore";
  const plan: AgentPlan = {
    updatedAt: "2026-06-08T01:00:00.000Z",
    entries: [
      { content: "恢复 plan", priority: "high", status: "completed" },
      { content: "继续验证", priority: "medium", status: "in_progress" },
    ],
  };
  const agent: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = { name: "main", path: "D:/repo" };
  const summary: SessionSummary = {
    id: sessionId,
    title: "Plan restore",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    messageCount: 0,
    runtimeSessionId: "runtime-codex-plan",
  };
  let recordedPlan: AgentPlan | undefined;

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => [],
      replace: () => undefined,
    },
    sessionArtifactStore: {
      remove: () => undefined,
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "codex",
        runtimeSessionId: "runtime-codex-plan",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async (input: any) => {
        input.onRestoreReplayEvent?.({ type: "plan-update", plan });
        return {
          runtimeSessionId: "runtime-codex-plan",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          cancel: () => undefined,
        };
      },
    },
    providerHistory: {
      hasHistoryContent: (history: { plan?: AgentPlan }) => Boolean(history.plan),
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
      recordSessionPlan: (_sessionId: string, nextPlan: AgentPlan | undefined) => {
        recordedPlan = nextPlan;
      },
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: { append: () => undefined },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-06-08T00:00:00.000Z",
      runtimeSessionId: "runtime-codex-plan",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.equal(recordedPlan, undefined);
});

test("session restore failure logs visible error details", async () => {
  const sessionId = "session-codex-restore-failure";
  const agent: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = { name: "main", path: "D:/repo" };
  const summary: SessionSummary = {
    id: sessionId,
    title: "Restore failure",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    messageCount: 0,
    runtimeSessionId: "runtime-codex-fail",
  };
  let errorEvent = "";
  let errorFields: Record<string, unknown> = {};

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => [],
      replace: () => undefined,
    },
    sessionArtifactStore: {
      remove: () => undefined,
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "codex",
        runtimeSessionId: "runtime-codex-fail",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async () => {
        throw new Error("Internal error");
      },
    },
    providerHistory: {
      hasHistoryContent: () => false,
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
      recordSessionPlan: () => undefined,
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: { append: () => undefined },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-06-08T00:00:00.000Z",
      runtimeSessionId: "runtime-codex-fail",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logger: {
      debug: () => undefined,
      error: (event: string, fields: Record<string, unknown>) => {
        errorEvent = event;
        errorFields = fields;
      },
    },
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  const result = await service.startSessionResume(sessionId);

  assert.equal(result.ok, false);
  assert.equal(errorEvent, "runtime.session_restore.failed");
  assert.equal(errorFields.errorMessage, "Internal error");
  assert.equal(errorFields.runtimeSessionId, "runtime-codex-fail");
  assert.equal(errorFields.method, "session/load");
  assert.equal(errorFields.providerId, "codex");
});

test("force reload active session releases old runtime before ACP load restore", async () => {
  const sessionId = "session-codex-active-reimport";
  const agent: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = { name: "main", path: "D:/repo" };
  const summary: SessionSummary = {
    id: sessionId,
    title: "Active reimport",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-06-08T00:00:00.000Z",
    updatedAt: "2026-06-08T00:00:00.000Z",
    messageCount: 1,
    runtimeSessionId: "runtime-codex-1",
  };
  let oldRuntimeClosed = false;
  let oldRuntimeCancelled = false;
  let createRuntimeSawOldRuntimeClosed = false;
  let restoreStrategy = "";
  const sessions = new Map<string, any>([
    [
      sessionId,
      {
        summary,
        agent,
        worktree,
        runtime: {
          runtimeSessionId: "runtime-codex-1",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          close: async () => {
            oldRuntimeClosed = true;
            return { kind: "unsupported", providerId: "codex", message: "closed" };
          },
          cancel: () => {
            oldRuntimeCancelled = true;
          },
        },
      },
    ],
  ]);

  const service = createSessionResumeService({
    sessions,
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => [],
      replace: () => undefined,
    },
    sessionArtifactStore: {
      remove: () => undefined,
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "codex",
        runtimeSessionId: "runtime-codex-1",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async (input: any) => {
        createRuntimeSawOldRuntimeClosed = oldRuntimeClosed;
        restoreStrategy = input.restore?.strategy ?? "";
        return {
          runtimeSessionId: "runtime-codex-1",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          cancel: () => undefined,
        };
      },
    },
    providerHistory: {
      hasHistoryContent: () => false,
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: { append: () => undefined },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-06-08T00:00:00.000Z",
      runtimeSessionId: "runtime-codex-1",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId, { forceReloadActive: true });

  assert.equal(createRuntimeSawOldRuntimeClosed, true);
  assert.equal(restoreStrategy, "load");
  assert.equal(oldRuntimeCancelled, false);
});

test("session restore ignores asynchronous ACP replay", async () => {
  const sessionId = "session-codex-replay";
  const agent: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = { name: "main", path: "D:/repo" };
  const summary: SessionSummary = {
    id: sessionId,
    title: "重导入历史",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-06-07T13:09:18.000Z",
    updatedAt: "2026-06-07T13:09:18.000Z",
    messageCount: 1,
    runtimeSessionId: "runtime-codex-1",
  };
  const storedMessages: AgentMessage[] = [];
  const storedToolCalls: AgentToolCall[] = [];
  let storedTimeline: SessionTimelineEntry[] = [];

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => storedMessages,
      replace: (_sessionId: string, messages: AgentMessage[]) => {
        storedMessages.splice(0, storedMessages.length, ...messages);
      },
    },
    sessionArtifactStore: {
      remove: () => {
        storedToolCalls.splice(0, storedToolCalls.length);
      },
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "codex",
        runtimeSessionId: "runtime-codex-1",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async (input: any) => {
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "user-1",
            role: "user",
            text: "重新导入",
            timestamp: "2026-06-07T13:09:18.204Z",
          },
        });
        setTimeout(() => {
          input.onRestoreReplayEvent?.({
            type: "tool-call",
            toolCall: {
              id: "tool-1",
              kind: "shell",
              title: "git status --short",
              status: "completed",
              timestamp: "2026-06-07T13:09:18.207Z",
              updatedAt: "2026-06-07T13:09:18.207Z",
            },
          });
        }, 10);
        setTimeout(() => {
          input.onRestoreReplayEvent?.({
            type: "message",
            message: {
              id: "assistant-1",
              role: "assistant",
              text: "工具后继续输出",
              timestamp: "2026-06-07T13:09:18.206Z",
            },
          });
        }, 20);
        return {
          runtimeSessionId: "runtime-codex-1",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          cancel: () => undefined,
        };
      },
    },
    providerHistory: {
      hasHistoryContent: (history: { messages: unknown[]; toolCalls: unknown[] }) =>
        history.messages.length > 0 || history.toolCalls.length > 0,
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: {
        append: (_sessionId: string, message: AgentMessage) => {
          storedMessages.push(message);
        },
      },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: (_sessionId: string, toolCall: AgentToolCall) => {
          storedToolCalls.push(toolCall);
        },
        replaceDiffs: () => undefined,
      },
      sessionTimelineStore: {
        replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
          storedTimeline = entries;
          return entries;
        },
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-06-07T13:09:18.000Z",
      runtimeSessionId: "runtime-codex-1",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.deepEqual(storedMessages, []);
  assert.deepEqual(storedToolCalls, []);
  assert.deepEqual(storedTimeline, []);
});

test("session restore preserves a trailing compacted boundary from the canonical timeline", async () => {
  const sessionId = "session-compacted-tail-patch";
  const agent: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = { name: "main", path: "D:/repo" };
  const summary: SessionSummary = {
    id: sessionId,
    title: "Compacted replay",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-06-18T14:00:00.000Z",
    updatedAt: "2026-06-18T14:00:00.000Z",
    messageCount: 2,
    runtimeSessionId: "runtime-codex-tail",
  };
  let persistedMessages: AgentMessage[] = [
    {
      id: "older-user",
      role: "user",
      text: "压缩前问题",
      timestamp: "2026-06-18T14:01:20.000Z",
      sequence: 10,
    },
    {
      id: "anchor-user",
      role: "user",
      text: "锚点消息",
      timestamp: "2026-06-18T14:01:49.292Z",
      sequence: 20,
    },
  ];
  let persistedTimeline: SessionTimelineEntry[] = [
    {
      id: "older-user",
      kind: "user_message",
      message: persistedMessages[0]!,
      timestamp: persistedMessages[0]!.timestamp,
      updatedAt: persistedMessages[0]!.timestamp,
      sequence: 10,
    },
    {
      id: "anchor-user",
      kind: "user_message",
      message: persistedMessages[1]!,
      timestamp: persistedMessages[1]!.timestamp,
      updatedAt: persistedMessages[1]!.timestamp,
      sequence: 20,
    },
    {
      id: `compaction:${sessionId}:compaction-summary`,
      kind: "context_compaction",
      phase: "completed",
      source: "heuristic",
      summaryMessageId: "compaction-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      detailsVisibility: "expandable",
      timestamp: "2026-06-18T14:05:25.193Z",
      updatedAt: "2026-06-18T14:05:25.193Z",
      replayCompleteness: "compacted",
    },
  ];

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => persistedMessages,
      replace: (_sessionId: string, messages: unknown[]) => {
        persistedMessages = messages as AgentMessage[];
      },
    },
    sessionArtifactStore: {
      remove: () => undefined,
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "codex",
        runtimeSessionId: "runtime-codex-tail",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async (input: any) => {
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "compaction-summary",
            role: "user",
            text: "This session is being continued from a previous conversation that ran out of context.",
            timestamp: "2026-06-18T14:05:25.193Z",
          },
        });
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "anchor-user",
            role: "user",
            text: "锚点消息",
            timestamp: "2026-06-18T14:01:49.292Z",
            sequence: 20,
          },
        });
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "new-assistant",
            role: "assistant",
            text: "新的回复",
            timestamp: "2026-06-18T14:02:16.000Z",
            sequence: 21,
          },
        });
        return {
          runtimeSessionId: "runtime-codex-tail",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          cancel: () => undefined,
        };
      },
    },
    providerHistory: {
      hasHistoryContent: (history: { messages: unknown[] }) => history.messages.length > 0,
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: {
        append: (_sessionId: string, message: AgentMessage) => {
          persistedMessages = [...persistedMessages, message];
        },
      },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
          persistedTimeline = entries;
          return entries;
        },
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-06-18T14:00:00.000Z",
      runtimeSessionId: "runtime-codex-tail",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.deepEqual(
    persistedMessages.map((message) => message.id),
    ["older-user", "anchor-user"],
  );
  assert.deepEqual(
    persistedTimeline.map((entry) => entry.id),
    [
      "older-user",
      "anchor-user",
      `compaction:${sessionId}:compaction-summary`,
    ],
  );
  assert.deepEqual(
    persistedTimeline.map((entry) => entry.kind),
    [
      "user_message",
      "user_message",
      "context_compaction",
    ],
  );
});

test("session restore preserves markerless trailing compaction order", async () => {
  const sessionId = "session-compacted-replay-without-markers";
  const agent: AcpAgentProvider = {
    id: "claudecode",
    name: "ClaudeCode",
    command: "claude-code-acp",
    transport: "stdio",
    protocol: "acp",
  };
  const worktree: WorktreeSummary = { name: "main", path: "D:/repo" };
  const summary: SessionSummary = {
    id: sessionId,
    title: "Compacted replay without markers",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "claudecode",
    agentName: "ClaudeCode",
    cwd: "D:/repo",
    createdAt: "2026-06-18T14:00:00.000Z",
    updatedAt: "2026-06-18T14:00:00.000Z",
    messageCount: 2,
    runtimeSessionId: "runtime-claude-tail",
  };
  let persistedTimeline: SessionTimelineEntry[] = [
    {
      id: "assistant-after-compaction",
      kind: "assistant_message",
      chunks: [
        {
          id: "assistant-after-compaction:content",
          kind: "content",
          text: "压缩后的第一条回复",
          timestamp: "2026-06-18T14:02:16.000Z",
          sequence: 21,
        },
      ],
      timestamp: "2026-06-18T14:02:16.000Z",
      updatedAt: "2026-06-18T14:02:16.000Z",
      sequence: 21,
    },
    {
      id: "user-after-compaction",
      kind: "user_message",
      message: {
        id: "user-after-compaction",
        role: "user",
        text: "继续",
        timestamp: "2026-06-18T14:02:40.000Z",
        sequence: 22,
      },
      timestamp: "2026-06-18T14:02:40.000Z",
      updatedAt: "2026-06-18T14:02:40.000Z",
      sequence: 22,
    },
    {
      id: `compaction:${sessionId}:runtime-summary`,
      kind: "context_compaction",
      phase: "completed",
      source: "heuristic",
      summaryMessageId: "runtime-summary",
      summaryText: "This session is being continued from a previous conversation that ran out of context.",
      detailsVisibility: "expandable",
      timestamp: "2026-06-18T17:22:48.093Z",
      updatedAt: "2026-06-18T17:22:48.093Z",
      replayCompleteness: "compacted",
    },
  ];

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: () => undefined,
    },
    sessionMessageStore: {
      list: () => [],
      replace: () => undefined,
    },
    sessionArtifactStore: {
      remove: () => undefined,
    },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "claudecode",
        runtimeSessionId: "runtime-claude-tail",
        capabilities: { sessionLoad: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async (input: any) => {
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "assistant-after-compaction",
            role: "assistant",
            text: "压缩后的第一条回复",
            timestamp: "2026-06-18T14:02:16.000Z",
            sequence: 21,
          },
        });
        input.onRestoreReplayEvent?.({
          type: "message",
          message: {
            id: "user-after-compaction",
            role: "user",
            text: "继续",
            timestamp: "2026-06-18T14:02:40.000Z",
            sequence: 22,
          },
        });
        return {
          runtimeSessionId: "runtime-claude-tail",
          sessionCapabilities: { sessionLoad: true },
          prompt: async () => undefined,
          cancel: () => undefined,
        };
      },
    },
    providerHistory: {
      hasHistoryContent: (history: { messages: unknown[] }) => history.messages.length > 0,
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
    } as any,
    getAgents: () => [agent],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: {
        append: () => undefined,
      },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
      sessionTimelineStore: {
        list: () => persistedTimeline,
        replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
          persistedTimeline = entries;
          return entries;
        },
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-provider",
      state: "resume-available",
      reason: "load",
      checkedAt: "2026-06-18T14:00:00.000Z",
      runtimeSessionId: "runtime-claude-tail",
      restoreMethod: "session/load",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.deepEqual(
    persistedTimeline.map((entry) => [entry.kind, entry.id]),
    [
      ["assistant_message", "assistant-after-compaction"],
      ["user_message", "user-after-compaction"],
      ["context_compaction", `compaction:${sessionId}:runtime-summary`],
    ],
  );
});

test("session restore prefers runtime model state over stale persisted summary values", async () => {
  const sessionId = "session-stale-model";
  const summary: SessionSummary = {
    id: sessionId,
    title: "旧会话",
    status: "idle",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    agentId: "claude-code",
    agentName: "Claude Code",
    cwd: "D:/repo",
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:00.000Z",
    messageCount: 4,
    runtimeSessionId: "runtime-old",
    model: "claude-sonnet-old",
    modelOptions: [{ id: "claude-sonnet-old", name: "Claude Sonnet Old" }],
  };
  const worktree: WorktreeSummary = {
    name: "main",
    path: "D:/repo",
  };
  const stored = { summary: undefined as SessionSummary | undefined };

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
      get: () => summary,
      list: () => [summary],
      upsert: (next: SessionSummary) => {
        stored.summary = next;
      },
    },
    sessionMessageStore: { list: () => [], replace: () => undefined },
    sessionArtifactStore: { remove: () => undefined },
    sessionRuntimeStore: {
      get: () => ({
        sessionId,
        providerId: "claude-code",
        runtimeSessionId: "runtime-old",
        capabilities: { sessionResume: true },
        lastSeenAt: summary.updatedAt,
        state: "resumeable",
      }),
    },
    providerLifecycle: {
      createRuntime: async () => ({
        runtimeSessionId: "runtime-new",
        sessionCapabilities: { sessionResume: true },
        sessionConfigState: { model: "claude-sonnet-new" },
        sessionModelState: {
          currentModelId: "claude-sonnet-new",
          options: [{ id: "claude-sonnet-new", name: "Claude Sonnet New" }],
        },
        sessionConfigOptions: [],
        prompt: async () => undefined,
        cancel: () => undefined,
      }),
    },
    providerHistory: {
      hasHistoryContent: () => false,
      applyAuthoritativeProviderHistory: () => undefined,
      refreshAuthoritativeSessionHistory: async () => undefined,
    } as any,
    getAgents: () => [{
      id: "claude-code",
      name: "Claude Code",
      command: "claude-code",
      transport: "stdio",
      protocol: "acp",
    }],
    getProjects: () => [{ id: "project-1", path: "D:/repo" }],
    createHandlerContext: () => ({
      sessionMessageStore: { append: () => undefined },
      sessionArtifactStore: {
        appendOutput: () => undefined,
        appendToolCall: () => undefined,
        replaceDiffs: () => undefined,
      },
    } as any),
    resolveStoredSessionWorktree: () => worktree,
    buildResumeInfo: () => ({
      mode: "same-process",
      state: "resume-available",
      reason: "resume",
      checkedAt: "2026-07-06T00:00:00.000Z",
      runtimeSessionId: "runtime-new",
      restoreMethod: "session/resume",
    }),
    hydrateSessionSummary: (next: SessionSummary) => next,
    persistRuntimeDescriptor: () => undefined,
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logger: { debug: () => undefined, error: () => undefined } as any,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  const result = await service.startSessionResume(sessionId);

  assert.equal(result.ok, true);
  assert.equal(result.session?.model, "claude-sonnet-new");
  assert.deepEqual(result.session?.modelOptions, [
    { id: "claude-sonnet-new", name: "Claude Sonnet New" },
  ]);
  assert.equal(stored.summary?.model, "claude-sonnet-new");
});
