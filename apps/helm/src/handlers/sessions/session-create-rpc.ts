import type { SessionReasoningEffort, SessionSummary } from "@tiller/shared";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "../../runtime/session-config-options";
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
  context.logInfo(
    `[tiller] 阶段=新建会话请求 session=${sessionId} project=${project.id} helm=${helm.id} cwd=${worktree.path} agent=${agent.id}`,
  );
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
    const runtime = await context.createRuntime({
      sessionId,
      worktree,
      agent,
      sessionConfig,
      onEvent: (event) => context.handleRuntimeEvent(sessionId, event),
      onConnectionLifecycleEvent: (event) => {
        const phaseMap = {
          "connection-open": "ACP连接新建",
          "connection-reuse": "ACP连接复用",
          "connection-pending": "ACP连接等待",
          "connection-replace": "ACP连接替换",
          "connection-reconnect": "ACP连接重连",
        } as const;
        context.logInfo(
          `[tiller] 阶段=${phaseMap[event.type]} provider=${event.providerId} key=${event.key} session=${event.sessionId ?? "<none>"} cwd=${event.cwd}`,
        );
      },
    });
    const summaryRuntimeModel = summary.model ?? runtime.sessionConfigState?.model;
    const resolvedRuntimeConfigOptions = resolveConfigOptionsForSelection({
      incomingOptions: runtime.sessionConfigOptions,
      previousOptions: summary.configOptions,
      selectedModel: summaryRuntimeModel,
    });
    const summaryWithRuntimeBase = {
      ...summary,
      status: "idle" as const,
      updatedAt: new Date().toISOString(),
      agentMode: summary.agentMode ?? runtime.sessionConfigState?.agentMode,
      model: summaryRuntimeModel,
      modelOptions: runtime.sessionModelState?.options ?? summary.modelOptions,
      configOptions: resolvedRuntimeConfigOptions.options,
      reasoningEffort: resolveConfigReasoningEffortForOptions(
        summary.reasoningEffort ?? runtime.sessionConfigState?.reasoningEffort,
        resolvedRuntimeConfigOptions,
      ),
      runtimeSessionId: runtime.runtimeSessionId,
    };
    context.sessions.set(sessionId, { summary: summaryWithRuntimeBase, agent, worktree, runtime });
    const summaryWithRuntime = context.hydrateSessionSummary(summaryWithRuntimeBase);
    context.logInfo(
      `[tiller] 阶段=新建会话ACP就绪 session=${sessionId} runtime=${runtime.runtimeSessionId} capabilities=${JSON.stringify(runtime.sessionCapabilities ?? {})}`,
    );
    context.sessions.set(sessionId, { summary: summaryWithRuntime, agent, worktree, runtime });
    context.sessionStore.upsert(summaryWithRuntime);
    context.persistRuntimeDescriptor(summaryWithRuntime, agent, runtime.sessionCapabilities);
    broadcastSessionUpdate(context, sessionId, {
      kind: "session_updated",
      session: summaryWithRuntime,
    });
    return { session: summaryWithRuntime };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create session runtime";
    broadcastErrorRaised(context, { sessionId, message });
    context.logError(
      `[tiller] 阶段=新建会话失败 project=${project.id} agent=${agent.id} cwd=${worktree.path} message=${message}`,
    );
    context.updateSessionSummary(sessionId, (current) => ({
      ...current,
      status: "error",
      updatedAt: new Date().toISOString(),
      lastMessagePreview: "Session startup failed",
    }));
    broadcastSessionUpdate(context, sessionId, {
      kind: "status_change",
      status: "error",
      message: "Session startup failed",
    });
    throw error;
  }
}
