import { normalizeProviderCleanupResult } from "@tiller/acp-runtime";
import { resolveSessionCleanupOutcome } from "../sessions/cleanup";
import { applyUserPromptToSummary } from "../sessions/summary-updates";
import type { ProviderCleanupResult } from "@tiller/acp-runtime";
import type { SessionSummary } from "@tiller/shared";
import type { HelmMessageHandler } from "./context";

type SessionSummaryPageOptions = {
  limit?: number;
  before?: string;
};

function pageSessionSummaries(sessions: SessionSummary[], options: SessionSummaryPageOptions = {}) {
  const sorted = sortSessionSummaries(sessions);
  const limit = normalizePageLimit(options.limit, 25, 200);
  const before = decodeHistoryCursor(options.before);
  const eligible = before
    ? sorted.filter((session) => compareSessionPosition(session, before) > 0)
    : sorted;
  const page = eligible.slice(0, limit);
  const hasMore = eligible.length > page.length;
  return {
    sessions: page,
    nextCursor: hasMore ? encodeHistoryCursor(page.at(-1)) : undefined,
    hasMore,
  };
}

function sortSessionSummaries(sessions: SessionSummary[]) {
  return [...sessions].sort((left, right) => compareSessionPosition(left, right));
}

function compareSessionPosition(left: Pick<SessionSummary, "id" | "createdAt" | "updatedAt">, right: Pick<SessionSummary, "id" | "createdAt" | "updatedAt">) {
  const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  const createdDelta = right.createdAt.localeCompare(left.createdAt);
  return createdDelta === 0 ? left.id.localeCompare(right.id) : createdDelta;
}

function normalizePageLimit(limit: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) {
    return fallback;
  }
  return Math.min(Math.floor(limit), max);
}

function encodeHistoryCursor(session: SessionSummary | undefined) {
  return session ? `${session.updatedAt}\t${session.createdAt}\t${session.id}` : undefined;
}

function decodeHistoryCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [updatedAt, createdAt, id] = cursor.split("\t");
  if (!updatedAt || !createdAt || !id) {
    return null;
  }
  return { updatedAt, createdAt, id };
}

export const handleSessionMessage: HelmMessageHandler = async (socket, payload, context) => {
  switch (payload.type) {
    case "session.list": {
      const normalizedSessions = context.sessionStore.list().map(context.migrateStoredSessionSummary);
      const page = pageSessionSummaries(normalizedSessions, { limit: payload.limit, before: payload.before });
      context.logInfo(`[tiller-helm] session.list count=${normalizedSessions.length} page=${page.sessions.length} hasMore=${page.hasMore}`);
      context.emit(socket, {
        type: "session.list.result",
        requestId: payload.requestId,
        sessions: page.sessions,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        before: payload.before,
      });
      return true;
    }
    case "session.messages.list": {
      await context.refreshAuthoritativeSessionHistory(payload.sessionId);
      const page = context.sessionMessageStore.listPage(payload.sessionId, {
        limit: payload.limit,
        before: payload.before,
      });
      context.emit(socket, {
        type: "session.messages.list.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        messages: page.messages,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        before: payload.before,
      });
      return true;
    }
    case "session.artifacts.get": {
      await context.refreshAuthoritativeSessionHistory(payload.sessionId);
      const artifacts = context.sessionArtifactStore.getPage(payload.sessionId, {
        limit: payload.limit,
        before: payload.before,
      });
      const diffs = await context.hydrateDiffsFromWorkspaceGit(payload.sessionId, artifacts.diffs);
      context.emit(socket, {
        type: "session.artifacts.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        outputs: artifacts.outputs,
        diffs,
        toolCalls: artifacts.toolCalls,
        nextCursor: artifacts.nextCursor,
        hasMore: artifacts.hasMore,
      });
      return true;
    }
    case "session.resume.check": {
      context.logInfo(`[tiller-helm] session.resume.check session=${payload.sessionId}`);
      const summary = context.sessionStore.list().find((item: any) => item.id === payload.sessionId);
      if (!summary) {
        context.emit(socket, { type: "error", requestId: payload.requestId, sessionId: payload.sessionId, message: "Session not found" });
        return true;
      }
      const hydrated = context.hydrateSessionSummary(summary);
      context.emit(socket, {
        type: "session.resume.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        resume: hydrated.resume ?? context.buildResumeInfo(hydrated, context.resolveProviderById(hydrated.agentId, context.getAgents())),
      });
      return true;
    }
    case "session.resume.start": {
      context.logInfo(`[tiller-helm] session.resume.start session=${payload.sessionId}`);
      const result = await context.startSessionResume(payload.sessionId);
      context.logInfo(`[tiller-helm] session.resume.start.result session=${payload.sessionId} ok=${result.ok} method=${result.resume.restoreMethod ?? "none"} message=${result.message}`);
      context.emit(socket, {
        type: "session.resume.start.result",
        requestId: payload.requestId,
        sessionId: payload.sessionId,
        ok: result.ok,
        resume: result.resume,
        message: result.message,
      });
      return true;
    }
    case "session.create": {
      const helms = context.loadAvailableHelms();
      const workspaces = context.loadAvailableWorkspaces();
      const agents = context.loadAvailableAgents();
      context.setHelms(helms);
      context.setWorkspaces(workspaces);
      context.setAgents(agents);
      const projects = await context.loadAvailableProjectsWithSemanticSummaries();
      context.setProjects(projects);

      const project = context.resolveProjectById(payload.projectId, projects);
      const workspace = workspaces.find((item) => item.id === payload.workspaceId);
      const agent = context.resolveProviderById(payload.agentId, agents);
      const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

      if (!project || !workspace || !agent || !helm) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Project, helm, workspace, or agent not found" });
        return true;
      }
      if (project.workspaceIds?.length && !project.workspaceIds.includes(workspace.id)) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Workspace does not belong to the selected project" });
        return true;
      }
      if (project.allowedAgentIds?.length && !project.allowedAgentIds.includes(agent.id)) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "ACP agent is not allowed for the selected project" });
        return true;
      }

      const sessionId = `session-${Date.now()}`;
      const createdAt = new Date().toISOString();
      context.logInfo(`[tiller-helm] session.create requested session=${sessionId} project=${project.id} helm=${helm.id} workspace=${workspace.id} workspaceName=${workspace.name} workspacePath=${workspace.path} agent=${agent.id}`);
      const summaryBase: SessionSummary = {
        id: sessionId,
        projectId: project.id,
        projectName: project.name,
        helmId: helm.id,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        agentId: agent.id,
        agentName: agent.name,
        agentMode: payload.agentMode,
        model: payload.model,
        reasoningEffort: payload.reasoningEffort,
        status: "starting" as const,
        createdAt,
        updatedAt: createdAt,
        messageCount: 0,
      };
      const summary = { ...summaryBase, resume: context.buildResumeInfo(summaryBase, agent) };
      context.sessionStore.upsert(summary);
      context.persistRuntimeDescriptor(summary, agent);
      context.broadcastAuthenticated({ type: "session.created", requestId: payload.requestId, session: summary });

      try {
        const runtime = await context.createRuntime({
          sessionId,
          workspace,
          agent,
          sessionConfig: { agentMode: summary.agentMode, model: summary.model, reasoningEffort: summary.reasoningEffort },
          onEvent: (event) => context.handleRuntimeEvent(sessionId, event),
        });
        const summaryWithRuntime = context.hydrateSessionSummary({
          ...summary,
          agentMode: runtime.sessionConfigState?.agentMode ?? summary.agentMode,
          model: runtime.sessionConfigState?.model ?? summary.model,
          modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
          reasoningEffort: runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
          runtimeSessionId: runtime.runtimeSessionId,
        });
        context.logInfo(`[tiller-helm] ACP session ready session=${sessionId} runtime=${runtime.runtimeSessionId} capabilities=${JSON.stringify(runtime.sessionCapabilities ?? {})}`);
        context.sessions.set(sessionId, { summary: summaryWithRuntime, agent, workspace, runtime });
        context.sessionStore.upsert(summaryWithRuntime);
        context.persistRuntimeDescriptor(summaryWithRuntime, agent, runtime.sessionCapabilities);
        context.broadcastAuthenticated({ type: "session.created", requestId: payload.requestId, session: summaryWithRuntime });
      } catch (error) {
        context.emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId,
          message: error instanceof Error ? error.message : "Failed to create session runtime",
        });
        context.logError(`[tiller-helm] session.create failed for project=${project.id} agent=${agent.id} workspace=${workspace.id} workspaceName=${workspace.name} workspacePath=${workspace.path}: ${error instanceof Error ? error.message : "Failed to create session runtime"}`);
        context.updateSessionSummary(sessionId, (current) => ({ ...current, status: "error", updatedAt: new Date().toISOString(), lastMessagePreview: "Session startup failed" }));
        context.broadcastAuthenticated({ type: "session.status", sessionId, status: "error", message: "Session startup failed" });
      }
      return true;
    }
    case "session.prompt": {
      let record = context.sessions.get(payload.sessionId);
      if (!record) {
        context.logInfo(`[tiller-helm] session.prompt restore-required session=${payload.sessionId} chars=${payload.text.length}`);
        const restore = await context.startSessionResume(payload.sessionId);
        context.logInfo(`[tiller-helm] session.prompt restore-result session=${payload.sessionId} ok=${restore.ok} method=${restore.resume.restoreMethod ?? "none"} message=${restore.message}`);
        context.emit(socket, {
          type: "session.resume.start.result",
          requestId: `session-prompt-restore-${Date.now()}`,
          sessionId: payload.sessionId,
          ok: restore.ok,
          resume: restore.resume,
          message: restore.message,
        });
        record = context.sessions.get(payload.sessionId);
      }
      if (!record) {
        context.logError(`[tiller-helm] session.prompt failed session=${payload.sessionId} reason=Session runtime not available`);
        context.emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          message: "Session runtime is not available. Try reconnecting this Mission first.",
        });
        return true;
      }
      const imageAttachments = payload.content?.filter((item) => item.type === "image") ?? [];
      if (imageAttachments.length && !record.runtime.sessionCapabilities?.imageInput) {
        context.emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: payload.sessionId,
          code: "ACP_IMAGE_INPUT_UNSUPPORTED",
          message: "ACP agent does not advertise image prompt capability.",
        });
        return true;
      }

      context.logInfo(`[tiller-helm] session.prompt session=${payload.sessionId} chars=${payload.text.length} images=${imageAttachments.length}`);
      const timestamp = new Date().toISOString();
      const userMessageId = payload.clientMessageId || `${payload.sessionId}-user-${Date.now()}`;
      context.persistSessionMessage(payload.sessionId, { id: userMessageId, role: "user", text: payload.text, timestamp, ...(imageAttachments.length ? { attachments: imageAttachments } : {}) });
      const updated = context.updateSessionSummary(payload.sessionId, (current) => applyUserPromptToSummary(current, payload.text, timestamp));
      if (updated) {
        context.broadcastAuthenticated({ type: "session.updated", requestId: payload.requestId, session: updated });
      }
      record.runtime.prompt(payload.text, payload.content);
      return true;
    }
    case "session.configure": {
      const current = context.sessions.get(payload.sessionId)?.summary ?? context.sessionStore.list().find((item: any) => item.id === payload.sessionId);
      if (!current) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Session not found" });
        return true;
      }
      const activeRecord = context.sessions.get(payload.sessionId);
      const runtimeResult = activeRecord ? await activeRecord.runtime.configure({ agentMode: payload.agentMode, model: payload.model, reasoningEffort: payload.reasoningEffort }) : null;
      const nextAgentMode = runtimeResult?.state.agentMode ?? payload.agentMode ?? current.agentMode;
      const nextModel = runtimeResult?.state.model ?? payload.model;
      const nextReasoning = runtimeResult?.state.reasoningEffort ?? payload.reasoningEffort;
      const nextModelOptions = runtimeResult?.modelState?.options ?? current.modelOptions;
      context.updateSessionSummary(payload.sessionId, (summary) => ({ ...summary, agentMode: nextAgentMode, model: nextModel, modelOptions: nextModelOptions, reasoningEffort: nextReasoning, updatedAt: new Date().toISOString() }));
      const next = context.hydrateSessionSummary({ ...current, agentMode: nextAgentMode, model: nextModel, modelOptions: nextModelOptions, reasoningEffort: nextReasoning, updatedAt: new Date().toISOString() });
      context.broadcastAuthenticated({ type: "session.updated", requestId: payload.requestId, session: next });
      return true;
    }
    case "permission.respond": {
      const permission = context.permissionIndex.get(payload.permissionRequestId);
      if (!permission) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Permission request not found" });
        return true;
      }
      const record = context.sessions.get(permission.sessionId);
      if (!record) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Session not found for permission response" });
        return true;
      }
      if (!record.runtime.supportsPermissionResponses) {
        context.emit(socket, {
          type: "error",
          requestId: payload.requestId,
          sessionId: permission.sessionId,
          message: "Real ACP permission passthrough is not wired yet. The request is still pending.",
          code: "ACP_PERMISSION_UNSUPPORTED",
        });
        return true;
      }
      context.permissionIndex.delete(payload.permissionRequestId);
      context.broadcastAuthenticated({ type: "permission.resolved", sessionId: permission.sessionId, permissionRequestId: payload.permissionRequestId, decision: payload.decision });
      record.runtime.respondPermission(payload.permissionRequestId, payload.decision);
      return true;
    }
    case "session.cancel": {
      const record = context.sessions.get(payload.sessionId);
      if (!record) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Session not found" });
        return true;
      }
      record.runtime.cancel();
      return true;
    }
    case "session.cleanup": {
      const record = context.sessions.get(payload.sessionId);
      const summary = record?.summary ?? context.sessionStore.list().find((item: any) => item.id === payload.sessionId);
      if (!summary) {
        context.emit(socket, { type: "error", requestId: payload.requestId, message: "Session not found" });
        return true;
      }
      const provider = record?.agent ?? context.resolveProviderById(summary.agentId, context.getAgents());
      let remoteResult;
      if (record) {
        context.sessions.delete(summary.id);
        remoteResult = normalizeProviderCleanupResult(await cleanupActiveRuntime(record.runtime, provider?.id ?? summary.agentId));
      } else {
        remoteResult = resolveSessionCleanupOutcome(summary, provider);
      }
      context.clearPermissionRequestsForSession(summary.id);
      context.deleteLocalSessionData(summary.id);
      context.broadcastAuthenticated({
        type: "session.cleanup.result",
        requestId: payload.requestId,
        result: {
          sessionId: summary.id,
          localDeleted: true,
          remoteDeleted: remoteResult.remoteDeleted,
          remoteDeletionAttempted: remoteResult.remoteDeletionAttempted,
          providerId: remoteResult.providerId,
          message: remoteResult.message,
        },
      });
      return true;
    }
    default:
      return false;
  }
};
export async function cleanupActiveRuntime(runtime: {
  sessionCapabilities?: { sessionDelete?: boolean; sessionClose?: boolean };
  deleteSession?: () => Promise<ProviderCleanupResult>;
  close?: () => Promise<ProviderCleanupResult>;
  cancel: () => void;
}, providerId: string): Promise<ProviderCleanupResult> {
  if (runtime.sessionCapabilities?.sessionDelete && runtime.deleteSession) {
    const deleted = await runtime.deleteSession();
    runtime.cancel();
    if (deleted.kind === "remote-deleted") {
      return deleted;
    }
  }

  if (runtime.sessionCapabilities?.sessionClose && runtime.close) {
    return runtime.close();
  }

  runtime.cancel();
  return {
    kind: "unsupported",
    providerId,
    message: "ACP agent did not advertise session/delete or session/close; cleaned local Tiller session and terminated the local runtime process only.",
  };
}
