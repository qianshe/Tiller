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
  SessionUpdateRecord,
  SessionSummary,
  SessionTimelineEntry,
  WorktreeSummary,
} from "@tiller/shared";
import { createSessionResumeService } from "./resume-service.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "resume-service.ts"), "utf8");

test("restore replay completion logs only when replay content was persisted", () => {
  assert.match(source, /hasRestoreReplayContent/);
  assert.match(
    source,
    /if \(hasRestoreReplayContent\(replayCounts\)\) \{\s*logResumeInfo\(options, "runtime\.restore_replay\.completed"/,
  );
});

test("session restore uses ACP load replay as authoritative history", async () => {
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
  let replayUpdates: SessionUpdateRecord[] = [];

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
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
      sessionUpdateStore: {
        replaceSession: (_sessionId: string, updates: SessionUpdateRecord[]) => {
          replayUpdates = updates;
        },
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
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.equal(appliedSource, "");
  assert.deepEqual(appliedMessages, []);
  assert.deepEqual(storedMessages.map((message) => [message.id, message.role, message.text]), [
    ["load-assistant-1", "assistant", "第一条回复"],
  ]);
  assert.deepEqual(replayUpdates.map((update) => [update.source, update.providerId, update.runtimeSessionId, update.updateType]), [
    ["acp_load_replay", "opencode", "runtime-1", "message"],
  ]);
});

test("session restore records replayed ACP plan for reimport hydration", async () => {
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
  let replayUpdates: SessionUpdateRecord[] = [];

  const service = createSessionResumeService({
    sessions: new Map(),
    sessionStore: {
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
      sessionUpdateStore: {
        replaceSession: (_sessionId: string, updates: SessionUpdateRecord[]) => {
          replayUpdates = updates;
        },
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

  assert.deepEqual(recordedPlan, plan);
  assert.deepEqual(
    replayUpdates.map((update) => [update.source, update.updateType]),
    [["acp_load_replay", "plan-update"]],
  );
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

test("session restore waits for asynchronous ACP replay before flushing", async () => {
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

  assert.deepEqual(
    storedMessages.map((message) => [message.role, message.text, message.timelineSequence]),
    [
      ["user", "重新导入", 1],
      ["assistant", "工具后继续输出", 3],
    ],
  );
  assert.deepEqual(storedToolCalls.map((toolCall) => [toolCall.title, toolCall.timelineSequence]), [
    ["git status --short", 2],
  ]);
  assert.deepEqual(
    storedTimeline.map((entry) => [entry.kind, entry.id, entry.timelineSequence]),
    [
      ["user_message", "user-1", 1],
      ["tool_call", "tool:tool-1", 2],
      ["assistant_message", "assistant-1", 3],
    ],
  );
});
