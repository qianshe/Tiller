import type { AgentPromptContent, SessionSummary } from "@tiller/shared";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "../../runtime/session-config-options";
import { sendPromptToSession } from "../../runtime/session-runtime-router";
import type { HelmHandlerContext } from "../context";

export type SessionPromptParams = {
  sessionId?: string;
  draftId?: string;
  text: string;
  content?: AgentPromptContent[];
  clientMessageId?: string;
};

export async function promptSession(
  params: SessionPromptParams,
  context: HelmHandlerContext,
) {
  if (params.sessionId) {
    try {
      return await sendPromptToSession(
        {
          sessionId: params.sessionId,
          text: params.text,
          content: params.content,
          clientMessageId: params.clientMessageId,
        },
        context,
      );
    } catch (error) {
      broadcastPromptFailure(context, params.sessionId, error);
      throw error;
    }
  }
  if (!params.draftId) {
    throw new Error("sessionId or draftId is required");
  }
  return promptRuntimeDraft(params as SessionPromptParams & { draftId: string }, context);
}

async function promptRuntimeDraft(
  params: SessionPromptParams & { draftId: string },
  context: HelmHandlerContext,
) {
  const draft = context.takeRuntimeDraft(params.draftId);
  if (!draft) {
    throw new Error("Runtime draft is not available. Create a new session and retry.");
  }

  const sessionId = `session-${Date.now()}`;
  draft.attach(sessionId);
  const createdAt = new Date().toISOString();
  const summaryConfigModel = draft.configState.model ?? draft.runtime.sessionConfigState?.model;
  const resolvedSummaryConfigOptions = resolveConfigOptionsForSelection({
    incomingOptions: draft.runtime.sessionConfigOptions,
    previousOptions: draft.configOptions,
    selectedModel: summaryConfigModel,
  });
  const summaryConfigOptions = resolvedSummaryConfigOptions.options ?? [];
  const summaryReasoningEffort = resolveConfigReasoningEffortForOptions(
    draft.configState.reasoningEffort ?? draft.runtime.sessionConfigState?.reasoningEffort,
    resolvedSummaryConfigOptions,
  );
  const summaryBase: SessionSummary = {
    id: sessionId,
    projectId: draft.project.id,
    projectName: draft.project.name,
    helmId: draft.helm.id,
    cwd: draft.worktree.path,
    worktreeName: draft.worktree.name,
    agentId: draft.agent.id,
    agentName: draft.agent.name,
    agentMode: draft.configState.agentMode ?? draft.runtime.sessionConfigState?.agentMode,
    model: draft.configState.model ?? draft.runtime.sessionConfigState?.model,
    modelOptions: draft.runtime.sessionModelState?.options ?? draft.modelState?.options,
    configOptions: summaryConfigOptions,
    availableCommands: draft.availableCommands,
    reasoningEffort: summaryReasoningEffort,
    runtimeSessionId: draft.runtime.runtimeSessionId,
    status: "idle",
    createdAt,
    updatedAt: createdAt,
    messageCount: 0,
  };
  context.sessions.set(sessionId, {
    summary: summaryBase,
    agent: draft.agent,
    worktree: draft.worktree,
    runtime: draft.runtime,
  });
  const summary = context.hydrateSessionSummary({
    ...summaryBase,
    resume: context.buildResumeInfo(summaryBase, draft.agent),
  });
  context.sessions.set(sessionId, {
    summary,
    agent: draft.agent,
    worktree: draft.worktree,
    runtime: draft.runtime,
  });
  context.sessionStore.upsert(summary);
  context.persistRuntimeDescriptor(summary, draft.agent, draft.runtime.sessionCapabilities);
  broadcastSessionUpdate(context, sessionId, { kind: "session_updated", session: summary });
  context.logInfo(
    `[tiller] draft.activate draft=${params.draftId} session=${sessionId} runtime=${draft.runtime.runtimeSessionId} provider=${draft.agent.id}`,
  );

  try {
    const result = await sendPromptToSession({ ...params, sessionId }, context);
    const currentSummary = context.sessions.get(sessionId)?.summary ?? summary;
    const selectedModel = currentSummary.model ?? draft.configState.model ?? summaryConfigModel;
    const resolvedCurrentConfigOptions = resolveConfigOptionsForSelection({
      incomingOptions: currentSummary.configOptions,
      previousOptions: summary.configOptions,
      selectedModel,
    });
    const currentConfigOptions = resolvedCurrentConfigOptions.options;
    const currentReasoningEffort = resolveConfigReasoningEffortForOptions(
      currentSummary.reasoningEffort,
      resolvedCurrentConfigOptions,
    );
    const hydratedSummary = context.hydrateSessionSummary({
      ...currentSummary,
      model: selectedModel,
      configOptions: currentConfigOptions,
      reasoningEffort: currentReasoningEffort,
    });
    const sanitizedSummary = {
      ...hydratedSummary,
      model: selectedModel,
      configOptions: currentConfigOptions,
      reasoningEffort: currentReasoningEffort,
    };
    const record = context.sessions.get(sessionId);
    if (record) {
      record.summary = sanitizedSummary;
    }
    context.sessionStore.upsert(sanitizedSummary);
    context.persistRuntimeDescriptor(
      sanitizedSummary,
      draft.agent,
      draft.runtime.sessionCapabilities,
    );
    broadcastSessionUpdate(context, sessionId, {
      kind: "session_updated",
      session: sanitizedSummary,
    });
    return { ...result, session: sanitizedSummary };
  } catch (error) {
    broadcastPromptFailure(context, sessionId, error);
    throw error;
  }
}

function broadcastPromptFailure(context: HelmHandlerContext, sessionId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Prompt failed.";
  context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    status: "error",
    updatedAt: new Date().toISOString(),
    lastMessagePreview: "Prompt failed",
  }));
  broadcastErrorRaised(context, { sessionId, message });
  broadcastSessionUpdate(context, sessionId, {
    kind: "status_change",
    status: "error",
    message,
  });
}
