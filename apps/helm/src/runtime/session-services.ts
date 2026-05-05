import { createAcpRuntime, type SessionRuntimeEvent } from "@tiller/acp-runtime";
import { resolveProviderById } from "@tiller/agent-registry";
import type {
  AcpAgentProvider,
  AcpModelState,
  AgentMessage,
  AgentPromptContent,
  FileDiffSummary,
  PermissionRequest,
  SessionReasoningEffort,
  SessionResumeInfo,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { HelmToClient } from "@tiller/sync-protocol";
import type { HelmHandlerContext } from "../handlers/context";
import {
  alignSessionProjectBinding,
  createHelmSessionStores,
  loadProviderAuthoritativeHistory,
  normalizeDiffPath,
  readWorkspaceGitDiffs,
  type StoredSessionRuntimeDescriptor,
} from "../sessions/facade";
import { handleRuntimeEvent as dispatchRuntimeEvent } from "./events";
import { buildSessionResumeInfo, resolveSessionRestoreCapabilities } from "./resume-info";

type HelmSessionStores = ReturnType<typeof createHelmSessionStores>;

export type SessionRecord = {
  summary: SessionSummary;
  agent: AcpAgentProvider;
  workspace: WorkspaceSummary;
  runtime: {
    runtimeSessionId: string;
    sessionCapabilities?: StoredSessionRuntimeDescriptor["capabilities"];
    sessionConfigState?: {
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
    sessionModelState?: AcpModelState;
    prompt: (text: string, content?: AgentPromptContent[]) => void;
    configure: (next: { model?: string; reasoningEffort?: SessionReasoningEffort }) => Promise<{
      runtimeApplied: boolean;
      state: { model?: string; reasoningEffort?: SessionReasoningEffort };
      modelState?: AcpModelState;
    }>;
    respondPermission: (requestId: string, decision: "allow" | "deny") => void;
    cancel: () => void;
    supportsPermissionResponses: boolean;
  };
};

type SessionServicesOptions = {
  sessions: Map<string, SessionRecord>;
  permissionIndex: Map<string, { sessionId: string; request: PermissionRequest }>;
  sessionStore: HelmSessionStores["sessionStore"];
  sessionMessageStore: HelmSessionStores["sessionMessageStore"];
  sessionArtifactStore: HelmSessionStores["sessionArtifactStore"];
  sessionRuntimeStore: HelmSessionStores["sessionRuntimeStore"];
  getAgents: () => AcpAgentProvider[];
  getProjects: () => ProjectSummary[];
  getWorkspaces: () => WorkspaceSummary[];
  createHandlerContext: () => HelmHandlerContext;
  broadcastAuthenticated: (payload: HelmToClient) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

type ProjectSummary = import("@tiller/shared").ProjectSummary;

export function createSessionServices(options: SessionServicesOptions) {
  const openCodeHistoryRefreshes = new Map<string, number>();

  function handleRuntimeEvent(sessionId: string, event: SessionRuntimeEvent) {
    dispatchRuntimeEvent(sessionId, event, options.createHandlerContext());
  }

  function clearPermissionRequestsForSession(sessionId: string) {
    for (const [requestId, permission] of options.permissionIndex.entries()) {
      if (permission.sessionId === sessionId) {
        options.permissionIndex.delete(requestId);
      }
    }
  }

  function deleteLocalSessionData(sessionId: string) {
    options.sessionStore.remove(sessionId);
    options.sessionMessageStore.remove(sessionId);
    options.sessionArtifactStore.remove(sessionId);
    options.sessionRuntimeStore.remove(sessionId);
  }

  function persistSessionMessage(sessionId: string, message: AgentMessage) {
    options.sessionMessageStore.append(sessionId, message);
  }

  function updateSessionSummary(
    sessionId: string,
    mutate: (summary: SessionSummary) => SessionSummary,
  ) {
    const activeSummary = options.sessions.get(sessionId)?.summary;
    const persistedSummary = options.sessionStore.list().find((item) => item.id === sessionId);
    const base = activeSummary ?? persistedSummary;
    if (!base) {
      return undefined;
    }

    const next = hydrateSessionSummary(mutate(base));
    const record = options.sessions.get(sessionId);
    if (record) {
      record.summary = next;
    }
    options.sessionStore.upsert(next);
    persistRuntimeDescriptor(
      next,
      record?.agent ?? resolveProviderById(next.agentId, options.getAgents()),
      record?.runtime.sessionCapabilities,
    );
    return next;
  }

  function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
    const aligned = alignSessionProjectBinding(summary, options.getProjects());
    const record = options.sessions.get(summary.id);
    const agent = record?.agent ?? resolveProviderById(aligned.agentId, options.getAgents());
    const descriptor = options.sessionRuntimeStore.get(summary.id);
    const capabilities = resolveSessionRestoreCapabilities(
      agent,
      descriptor,
      record?.runtime.sessionCapabilities,
    );
    return {
      ...aligned,
      imageInput: capabilities.imageInput,
      resume: buildResumeInfo(aligned, agent),
    };
  }

  function migrateStoredSessionSummary(summary: SessionSummary) {
    const hydrated = hydrateSessionSummary(summary);
    if (
      hydrated.projectId !== summary.projectId ||
      hydrated.projectName !== summary.projectName ||
      hydrated.helmId !== summary.helmId
    ) {
      options.sessionStore.upsert(hydrated);
    }
    return hydrated;
  }

  function buildResumeInfo(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
  ): SessionResumeInfo {
    return buildSessionResumeInfo(
      summary,
      agent,
      options.sessions.get(summary.id),
      options.sessionRuntimeStore.get(summary.id),
    );
  }

  async function importAuthoritativeOpenCodeHistory(
    sessionId: string,
    agent: AcpAgentProvider,
    runtimeSessionId: string,
    cwd: string,
  ) {
    try {
      const history = await loadProviderAuthoritativeHistory(agent, runtimeSessionId, cwd);
      if (!history) {
        return false;
      }
      if (history.messages.length) {
        options.sessionMessageStore.replace(sessionId, history.messages);
      }
      if (history.toolCalls.length) {
        options.sessionArtifactStore.replaceToolCalls(sessionId, history.toolCalls);
      }
      options.logInfo(
        `[tiller] opencode.export.history session=${sessionId} runtime=${runtimeSessionId} messages=${history.messages.length} toolCalls=${history.toolCalls.length}`,
      );
      return true;
    } catch (error) {
      options.logError(
        `[tiller] opencode.export.history failed session=${sessionId}: ${error instanceof Error ? error.message : "OpenCode export failed."}`,
      );
      return false;
    }
  }

  async function refreshAuthoritativeSessionHistory(sessionId: string) {
    const lastRefresh = openCodeHistoryRefreshes.get(sessionId);
    if (lastRefresh && Date.now() - lastRefresh < 30_000) {
      return;
    }

    const activeRecord = options.sessions.get(sessionId);
    const summary =
      activeRecord?.summary ?? options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      return;
    }
    const agent = activeRecord?.agent ?? resolveProviderById(summary.agentId, options.getAgents());
    const workspace =
      activeRecord?.workspace ?? options.getWorkspaces().find((item) => item.id === summary.workspaceId);
    const runtimeSessionId =
      activeRecord?.runtime.runtimeSessionId ??
      summary.runtimeSessionId ??
      options.sessionRuntimeStore.get(sessionId)?.runtimeSessionId;
    if (!agent || !workspace || !runtimeSessionId) {
      return;
    }

    const refreshed = await importAuthoritativeOpenCodeHistory(
      sessionId,
      agent,
      runtimeSessionId,
      workspace.path,
    );
    if (refreshed) {
      openCodeHistoryRefreshes.set(sessionId, Date.now());
    }
  }

  async function startSessionResume(sessionId: string) {
    const activeRecord = options.sessions.get(sessionId);
    if (activeRecord) {
      await refreshAuthoritativeSessionHistory(sessionId);
      const resume = buildResumeInfo(activeRecord.summary, activeRecord.agent);
      options.logInfo(
        `[tiller] client reconnect session=${sessionId} runtime=${resume.runtimeSessionId ?? "unknown"}`,
      );
      return {
        ok: true,
        resume,
        message: "Client reconnected to the still-running Helm session; no ACP restore was needed.",
      };
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    if (!summary) {
      const now = new Date().toISOString();
      return {
        ok: false,
        resume: {
          mode: "none" as const,
          state: "resume-unavailable" as const,
          reason: "Session not found.",
          checkedAt: now,
        },
        message: "Session not found.",
      };
    }

    const agent = resolveProviderById(summary.agentId, options.getAgents());
    const workspace = options.getWorkspaces().find((item) => item.id === summary.workspaceId);
    const resume = buildResumeInfo(summary, agent);
    if (
      !agent ||
      !workspace ||
      !resume.runtimeSessionId ||
      (resume.restoreMethod !== "session/load" && resume.restoreMethod !== "session/resume")
    ) {
      return {
        ok: false,
        resume,
        message: resume.reason,
      };
    }

    try {
      options.logInfo(
        `[tiller] ACP restore begin session=${sessionId} runtime=${resume.runtimeSessionId} method=${resume.restoreMethod}`,
      );
      const runtime = await createAcpRuntime({
        sessionId,
        workspace,
        agent,
        sessionConfig: {
          model: summary.model,
          reasoningEffort: summary.reasoningEffort,
        },
        restore: {
          runtimeSessionId: resume.runtimeSessionId,
          strategy: resume.restoreMethod === "session/load" ? "load" : "resume",
        },
        onEvent: (event) => handleRuntimeEvent(sessionId, event),
      });
      const restoredSummary = hydrateSessionSummary({
        ...summary,
        model: runtime.sessionConfigState?.model ?? summary.model,
        modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
        reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
        runtimeSessionId: runtime.runtimeSessionId,
        status: "idle",
        updatedAt: new Date().toISOString(),
      });
      options.sessions.set(sessionId, { summary: restoredSummary, agent, workspace, runtime });
      options.sessionStore.upsert(restoredSummary);
      persistRuntimeDescriptor(restoredSummary, agent, runtime.sessionCapabilities);
      await importAuthoritativeOpenCodeHistory(
        sessionId,
        agent,
        runtime.runtimeSessionId,
        workspace.path,
      );
      options.logInfo(
        `[tiller] ACP restore success session=${sessionId} runtime=${runtime.runtimeSessionId} method=${resume.restoreMethod}`,
      );
      return {
        ok: true,
        resume: buildResumeInfo(restoredSummary, agent),
        message: `ACP ${resume.restoreMethod} completed for this session.`,
      };
    } catch (error) {
      options.logError(
        `[tiller] ACP restore failed session=${sessionId}: ${error instanceof Error ? error.message : "ACP restore failed."}`,
      );
      return {
        ok: false,
        resume: {
          ...resume,
          state: "resume-unavailable" as const,
          reason: error instanceof Error ? error.message : "ACP restore failed.",
          checkedAt: new Date().toISOString(),
        },
        message: error instanceof Error ? error.message : "ACP restore failed.",
      };
    }
  }

  function persistRuntimeDescriptor(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
  ) {
    const resolvedCapabilities = resolveSessionRestoreCapabilities(
      agent,
      options.sessionRuntimeStore.get(summary.id),
      capabilities,
    );
    if (
      !summary.runtimeSessionId &&
      !resolvedCapabilities.sessionLoad &&
      !resolvedCapabilities.sessionResume &&
      !resolvedCapabilities.sessionList &&
      !resolvedCapabilities.sessionClose &&
      !resolvedCapabilities.sessionDelete &&
      !resolvedCapabilities.imageInput
    ) {
      return;
    }

    options.sessionRuntimeStore.upsert({
      sessionId: summary.id,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId: summary.runtimeSessionId,
      capabilities: resolvedCapabilities,
      lastSeenAt: summary.updatedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  async function publishDiffUpdate(sessionId: string, files: FileDiffSummary[]) {
    const diffs = await hydrateDiffsFromWorkspaceGit(sessionId, files);
    options.sessionArtifactStore.replaceDiffs(sessionId, diffs);
    options.broadcastAuthenticated({
      type: "diff.update",
      sessionId,
      files: diffs,
    });
  }

  async function hydrateDiffsFromWorkspaceGit(sessionId: string, files: FileDiffSummary[]) {
    const workspace = resolveSessionWorkspace(sessionId);
    if (!workspace) {
      return files;
    }

    const gitDiffs = await readWorkspaceGitDiffs(workspace.path);
    if (!gitDiffs.length) {
      return files;
    }

    if (!files.length) {
      return gitDiffs;
    }

    const gitByPath = new Map(gitDiffs.map((file) => [normalizeDiffPath(file.path), file]));
    return files.map((file) => {
      const fromGit = gitByPath.get(normalizeDiffPath(file.path));
      return fromGit
        ? {
            ...file,
            additions: fromGit.additions,
            deletions: fromGit.deletions,
            patch: file.patch ?? fromGit.patch,
          }
        : file;
    });
  }

  function resolveSessionWorkspace(sessionId: string) {
    const liveWorkspace = options.sessions.get(sessionId)?.workspace;
    if (liveWorkspace) {
      return liveWorkspace;
    }

    const summary = options.sessionStore.list().find((item) => item.id === sessionId);
    return summary
      ? (options.getWorkspaces().find((workspace) => workspace.id === summary.workspaceId) ?? null)
      : null;
  }

  return {
    buildResumeInfo,
    clearPermissionRequestsForSession,
    deleteLocalSessionData,
    handleRuntimeEvent,
    hydrateDiffsFromWorkspaceGit,
    hydrateSessionSummary,
    migrateStoredSessionSummary,
    persistRuntimeDescriptor,
    persistSessionMessage,
    publishDiffUpdate,
    refreshAuthoritativeSessionHistory,
    startSessionResume,
    updateSessionSummary,
  };
}
