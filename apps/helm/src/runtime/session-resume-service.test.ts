import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AgentMessage,
  AgentToolCall,
  AcpAgentProvider,
  SessionSummary,
  SessionTimelineEntry,
  WorktreeSummary,
} from "@tiller/shared";
import { createSessionResumeService } from "./session-resume-service.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(currentDir, "session-resume-service.ts"), "utf8");

test("restore replay completion logs only when replay content was persisted", () => {
  assert.match(source, /hasRestoreReplayContent/);
  assert.match(
    source,
    /if \(hasRestoreReplayContent\(replayCounts\)\) \{\s*logResumeInfo\(options, "runtime\.restore_replay\.completed"/,
  );
});

test("session restore prefers adapter authoritative history over incomplete ACP load replay", async () => {
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
  const adapterMessages: AgentMessage[] = [
    {
      id: "adapter-user-2",
      role: "user",
      text: "第二条消息",
      timestamp: "2026-05-28T00:01:00.000Z",
    },
    {
      id: "adapter-assistant-2",
      role: "assistant",
      text: "第二条回复的最终结论",
      timestamp: "2026-05-28T00:01:30.000Z",
    },
  ];
  let appliedSource = "";
  let appliedMessages: AgentMessage[] = [];
  const storedMessages: AgentMessage[] = [];

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
      loadAdapterHistoryContent: async () => ({
        messages: adapterMessages,
        toolCalls: [],
        outputs: [],
        diffs: [],
      }),
      readLocalProviderHistory: () => ({
        messages: storedMessages,
        toolCalls: [],
        outputs: [],
        diffs: [],
      }),
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
    handleRuntimeEvent: () => undefined,
    logConnectionLifecycle: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  } as any);

  await service.startSessionResume(sessionId);

  assert.equal(appliedSource, "adapter-authoritative-history");
  assert.deepEqual(appliedMessages, adapterMessages);
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
      loadAdapterHistoryContent: async () => null,
      readLocalProviderHistory: () => ({
        messages: storedMessages,
        toolCalls: storedToolCalls,
        outputs: [],
        diffs: [],
      }),
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
