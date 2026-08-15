import { createSessionLifecycle } from "@tiller/core";
import type { SessionReasoningEffort, SessionSummary } from "@tiller/shared";
import { broadcastErrorRaised, broadcastInfoRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "../../runtime/session/config-options";
import {
  ensureLiveEventSequenceForSession,
  publishCanonicalSessionStateEvent,
} from "../../runtime/events";
import { updateSessionSummaryAndBroadcast } from "../../runtime/session/event/publisher";
import { createSessionBootstrapEvents } from "../../runtime/session/event/bootstrap";
import type { HelmHandlerContext } from "../context";
import { resolveProjectSessionWorktree } from "./session-worktree";

export type CreateSessionParams = {
  projectId: string;
  cwd: string;
  agentId: string;
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
};

export async function createSession(
  params: CreateSessionParams,
  context: HelmHandlerContext,
) {
  const helms = context.loadAvailableHelms();
  const worktrees = context.loadAvailableWorktrees();
  const agents = context.loadAvailableAgents();
  context.setHelms(helms);
  context.setWorktrees(worktrees);
  context.setAgents(agents);
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  context.setProjects(projects);

  const project = context.resolveProjectById(params.projectId, projects);
  const worktree = project
    ? resolveProjectSessionWorktree(project, worktrees, params)
    : undefined;
  const agent = context.resolveProviderById(params.agentId, agents);
  const helm = project ? context.resolveHelmById(project.helmId, helms) : undefined;

  if (!project || !worktree || !agent || !helm) {
    throw new Error("Project, helm, worktree, or agent not found");
  }

  const sessionId = `session-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const initialReasoningEffort = params.reasoningEffort;
  logSessionCreateInfo(context, "session.create.requested", {
    sessionId,
    projectId: project.id,
    helmId: helm.id,
    cwd: worktree.path,
    agentId: agent.id,
  });
  const summaryBase: SessionSummary = {
    id: sessionId,
    projectId: project.id,
    projectName: project.name,
    helmId: helm.id,
    cwd: worktree.path,
    worktreeName: worktree.name,
    agentId: agent.id,
    agentName: agent.name,
    agentMode: params.agentMode,
    model: params.model,
    reasoningEffort: initialReasoningEffort,
    status: "starting",
    createdAt,
    updatedAt: createdAt,
    messageCount: 0,
  };
  const summary = { ...summaryBase, resume: context.buildResumeInfo(summaryBase, agent) };
  context.sessionStore.upsert(summary);
  context.persistRuntimeDescriptor(summary, agent);
  broadcastSessionUpdate(context, sessionId, { kind: "session_updated", session: summary });

  try {
    const sessionConfig = {
      agentMode: summary.agentMode,
      model: summary.model,
      reasoningEffort: summary.reasoningEffort,
    };
    const lifecycle = createSessionLifecycle({
      resolveProject: async () => project,
      resolveAgent: async () => agent,
      createRuntime: async () =>
        context.createRuntime({
          sessionId,
          worktree,
          agent,
          sessionConfig,
          onEvent: (event) => context.handleRuntimeEvent(sessionId, event),
          onConnectionLifecycleEvent: (event) => {
            logSessionCreateInfo(context, "acp.connection.lifecycle", {
              type: event.type,
              providerId: event.providerId,
              key: event.key,
              sessionId: event.sessionId,
              cwd: event.cwd,
            });
          },
        }),
      buildSession: ({ runtime, timestamp }) => {
        const summaryRuntimeModel =
          runtime.sessionConfigState?.model ??
          runtime.sessionModelState?.currentModelId ??
          summary.model;
        const resolvedRuntimeConfigOptions = resolveConfigOptionsForSelection({
          incomingOptions: runtime.sessionConfigOptions,
          previousOptions: summary.configOptions,
          selectedModel: summaryRuntimeModel,
        });
        const summaryWithRuntimeBase = {
          ...summary,
          status: "idle" as const,
          updatedAt: timestamp,
          agentMode: runtime.sessionConfigState?.agentMode ?? summary.agentMode,
          model: summaryRuntimeModel,
          modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
          configOptions: resolvedRuntimeConfigOptions.options,
          reasoningEffort: resolveConfigReasoningEffortForOptions(
            runtime.sessionConfigState?.reasoningEffort ?? summary.reasoningEffort,
            resolvedRuntimeConfigOptions,
          ),
          runtimeSessionId: runtime.runtimeSessionId,
        };
        context.sessions.set(sessionId, { summary: summaryWithRuntimeBase, agent, worktree, runtime });
        return context.hydrateSessionSummary(summaryWithRuntimeBase);
      },
      persistSession: async (nextSummary) => {
        context.sessionStore.upsert(nextSummary);
      },
    });
    const { session: summaryWithRuntime, runtime } = await lifecycle.createSession({
      sessionId,
      projectId: project.id,
      agentId: agent.id,
      cwd: worktree.path,
      status: "idle",
    });
    logSessionCreateInfo(context, "session.create.runtime_ready", {
      sessionId,
      runtimeSessionId: runtime.runtimeSessionId,
      capabilities: runtime.sessionCapabilities ?? {},
    });
    broadcastInfoRaised(context, {
      sessionId,
      code: "ACP_SESSION_STARTED",
      message: "ACP session started.",
      source: "session",
    });
    context.sessions.set(sessionId, { summary: summaryWithRuntime, agent, worktree, runtime });
    ensureLiveEventSequenceForSession(sessionId, context);
    context.persistRuntimeDescriptor(summaryWithRuntime, agent, runtime.sessionCapabilities);
    for (const event of createSessionBootstrapEvents(summaryWithRuntime)) {
      context.handleRuntimeEvent(sessionId, event);
    }
    broadcastSessionUpdate(context, sessionId, {
      kind: "session_updated",
      session: summaryWithRuntime,
    });
    return { session: summaryWithRuntime };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session runtime";
    broadcastErrorRaised(context, {
      sessionId,
      code: "ACP_SESSION_START_FAILED",
      message,
      source: "session",
    });
    logSessionCreateError(context, "session.create.failed", {
      projectId: project.id,
      agentId: agent.id,
      cwd: worktree.path,
      message,
    });
    updateSessionSummaryAndBroadcast(context, sessionId, (current) => ({
      ...current,
      status: "error",
      updatedAt: new Date().toISOString(),
      lastMessagePreview: "Session startup failed",
    }));
    publishCanonicalSessionStateEvent(sessionId, { type: "status", status: "error" }, context);
    throw error;
  }
}

function logSessionCreateInfo(
  context: HelmHandlerContext,
  event: string,
  fields: Record<string, unknown>,
) {
  if (context.logger) {
    if (event === "acp.connection.lifecycle") {
      context.logger.debug(event, fields);
      return;
    }
    context.logger.info(event, fields);
    return;
  }
  context.logInfo(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logSessionCreateError(
  context: HelmHandlerContext,
  event: string,
  fields: Record<string, unknown>,
) {
  if (context.logger) {
    context.logger.error(event, fields);
    return;
  }
  context.logError(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}
