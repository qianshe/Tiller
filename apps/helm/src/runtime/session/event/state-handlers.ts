import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { HelmHandlerContext } from "../../../handlers/context";
import { handleRuntimePermissionRequest } from "../../approval-boundary";
import { emitFirstHelmPromptTrace } from "../../prompt-trace";
import {
  startNextAssistantResponseSegment,
} from "../../segment-state";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "../config-options";
import { materializeDiffPayloads } from "../diff-payload";
import {
  assertCanonicalTimelinePipeline,
  commitCanonicalStateEvent,
  logRuntimePlanUpdate,
  peekLiveEventSequence,
  prepareRuntimeSessionUpdate,
} from "./canonical";
import { flushLiveAssistantMessage } from "./message-stream";
import { createSessionEventPublisher } from "./publisher";
import {
  logRuntimeDebug,
  logRuntimeError,
  logRuntimeInfo,
  runtimeLogFields,
  runtimeLogScope,
} from "./support";
import {
  finalizeActiveRuntimeToolCalls,
} from "./tool-call";

export function handleRuntimeStatusEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "status" }>,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  emitFirstHelmPromptTrace(context, {
    sessionId,
    phase: "helm.runtime.first_status",
    meta: { status: event.status },
  });
  const statusSequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
  flushLiveAssistantMessage(sessionId, context);
  if (event.status === "running") {
    startNextAssistantResponseSegment(sessionId);
  } else {
    const terminalStatus = event.status === "error"
      ? "failed"
      : event.status === "cancelled"
        ? "cancelled"
        : "completed";
    finalizeActiveRuntimeToolCalls(sessionId, terminalStatus, context, {
      includeSubagents: terminalStatus !== "completed",
    });
  }
  context.sessionTimelineFlushScheduler.flushNow(sessionId);
  logRuntimeInfo(context, "runtime.status.changed", {
    ...runtimeLogFields(sessionId, context),
    seq: statusSequence ?? 0,
    status: event.status,
    messageChars: event.message?.length ?? 0,
  });
  const updated = context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    status: event.status,
    updatedAt: new Date().toISOString(),
  }));
  if (updated) {
    // Status transitions are lifecycle events: broadcast them globally (not
    // just to session-topic subscribers) so viewers that never open the
    // session (e.g. the dashboard) stay in sync.
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }
  if (event.status === "idle" || event.status === "error" || event.status === "cancelled") {
    context.sessionUpdateStore.compactTail(sessionId);
  }
}

export function handleRuntimePermissionEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "permission-request" }>,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  flushLiveAssistantMessage(sessionId, context);
  context.sessionTimelineFlushScheduler.flushNow(sessionId);
  const preparedApproval = context.sessionApprovalStateStore && context.sessionLiveStateStore
    ? prepareRuntimeSessionUpdate(sessionId, event, context)
    : undefined;
  const approvalSequence = preparedApproval?.resolvedSequence;
  logRuntimeInfo(context, "runtime.permission.requested", {
    ...runtimeLogFields(sessionId, context),
    seq: approvalSequence ?? 0,
    requestId: event.request.id,
    reasonChars: event.request.reason.length,
  });
  handleRuntimePermissionRequest(
    {
      sessionId,
      request: event.request,
      logScope: runtimeLogScope(sessionId, context),
      sequence: approvalSequence,
      update: preparedApproval?.update,
    },
    context,
  );
}

export function handleRuntimePlanEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "plan-update" }>,
  context: HelmHandlerContext,
) {
  const sequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
  logRuntimePlanUpdate(sessionId, event, context, sequence);
}

export function handleRuntimeDiffEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "diff-update" }>,
  context: HelmHandlerContext,
) {
  const files = context.sessionDiffBodyStore
    ? materializeDiffPayloads(sessionId, event.files, context.sessionDiffBodyStore)
    : event.files;
  context.sessionArtifactStore.replaceDiffs(sessionId, files);
  const sequence = commitCanonicalStateEvent(
    sessionId,
    { ...event, files },
    context,
  )?.sequence;
  flushLiveAssistantMessage(sessionId, context);
  logRuntimeInfo(context, "runtime.diff.updated", {
    ...runtimeLogFields(sessionId, context),
    seq: sequence ?? 0,
    files: event.files.length,
    paths: event.files.map((file) => file.path).slice(0, 8),
  });
}

export function handleRuntimeConfigOptionsEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "config-options" }>,
  context: HelmHandlerContext,
) {
  flushLiveAssistantMessage(sessionId, context);
  const current = context.sessions.get(sessionId)?.summary ?? context.sessionStore.get(sessionId);
  const resolvedModel = event.state.model ?? current?.model;
  const resolvedConfigOptions = resolveConfigOptionsForSelection({
    incomingOptions: event.options,
    previousOptions: current?.configOptions,
    selectedModel: resolvedModel,
  });
  const resolvedReasoningEffort = resolveConfigReasoningEffortForOptions(
    event.state.reasoningEffort ?? current?.reasoningEffort,
    resolvedConfigOptions,
  );
  const resolvedOptions = resolvedConfigOptions.options ?? [];
  const resolvedState = {
    ...event.state,
    model: resolvedModel,
    reasoningEffort: resolvedReasoningEffort,
  };
  const canonicalEvent = {
    ...event,
    state: resolvedState,
    options: resolvedOptions,
  };
  const sequence = commitCanonicalStateEvent(sessionId, canonicalEvent, context)?.sequence;
  logRuntimeDebug(context, "runtime.config_options.received", {
    ...runtimeLogFields(sessionId, context),
    seq: sequence ?? 0,
    agentMode: event.state.agentMode ?? "<none>",
    model: resolvedModel ?? "<none>",
    reasoning: resolvedReasoningEffort ?? "<none>",
    options: resolvedOptions.length,
  });
  context.updateSessionSummary(sessionId, (currentSummary) => ({
    ...currentSummary,
    agentMode: event.state.agentMode ?? currentSummary.agentMode,
    model: resolvedModel,
    configOptions: resolvedOptions,
    reasoningEffort: resolvedReasoningEffort,
    updatedAt: new Date().toISOString(),
  }));
}

export function handleRuntimeModelOptionsEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "model-options" }>,
  context: HelmHandlerContext,
) {
  flushLiveAssistantMessage(sessionId, context);
  const sequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
  logRuntimeDebug(context, "runtime.model_options.received", {
    ...runtimeLogFields(sessionId, context),
    seq: sequence ?? 0,
    currentModel: event.state.currentModelId ?? "<none>",
    options: event.state.options.length,
  });
  context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    model: event.state.currentModelId ?? current.model,
    modelOptions: event.state.options,
    updatedAt: new Date().toISOString(),
  }));
}

export function handleRuntimeAvailableCommandsEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "available-commands" }>,
  context: HelmHandlerContext,
) {
  flushLiveAssistantMessage(sessionId, context);
  const sequence = commitCanonicalStateEvent(sessionId, event, context)?.sequence;
  logRuntimeDebug(context, "runtime.available_commands.received", {
    ...runtimeLogFields(sessionId, context),
    seq: sequence ?? 0,
    commands: event.commands.length,
  });
  context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    availableCommands: event.commands,
    updatedAt: new Date().toISOString(),
  }));
}

export function handleRuntimeCanonicalStateEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, {
    type: "mode-update" | "session-info" | "usage-update";
  }>,
  context: HelmHandlerContext,
) {
  commitCanonicalStateEvent(sessionId, event, context);
}

export function handleRuntimeErrorEvent(
  sessionId: string,
  event: Extract<SessionRuntimeEvent, { type: "error" }>,
  context: HelmHandlerContext,
) {
  assertCanonicalTimelinePipeline(context);
  flushLiveAssistantMessage(sessionId, context);
  finalizeActiveRuntimeToolCalls(sessionId, "failed", context);
  context.sessionTimelineFlushScheduler.flushNow(sessionId);
  logRuntimeError(context, "runtime.error", {
    ...runtimeLogFields(sessionId, context),
    seq: peekLiveEventSequence(sessionId, context),
    code: event.code ?? "UNKNOWN",
    messageChars: event.message.length,
  });
  context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    status: "error",
    updatedAt: new Date().toISOString(),
    lastMessagePreview: event.message.slice(0, 160),
  }));
  if (event.code === "ACP_CONNECTION_EXITED") {
    context.sessions.delete(sessionId);
    logRuntimeInfo(context, "runtime.recoverable.marked", {
      ...runtimeLogFields(sessionId, context),
      code: event.code,
    });
  }
  createSessionEventPublisher(context).errorRaised({
    sessionId,
    message: event.message,
    code: event.code,
  });
}
