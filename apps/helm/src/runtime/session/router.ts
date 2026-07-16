import type {
  AgentPromptContent,
  SessionConfigOptionValue,
  SessionQueuedPrompt,
  SessionReasoningEffort,
  SessionSummary,
} from "@tiller/shared";
import { SendPromptUseCase } from "@tiller/core";
import {
  ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
  ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
} from "@tiller/shared";
import { applyUserPromptToSummary } from "../../sessions/facade";
import { createSessionEventPublisher } from "./event/publisher";
import {
  allocateLiveEventSequence,
  flushLiveAssistantMessage,
  handleRuntimeEvent,
  prepareRuntimeSessionUpdate,
  publishCanonicalSessionStateEvent,
  publishPromptQueueState,
} from "../events";
import type { HelmHandlerContext } from "../../handlers/context";
import { emitHelmPromptTrace } from "../prompt-trace";
import { routeSessionRuntimeEvent } from "../session-timeline/event-router";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./config-options";
import { assertSupportedSlashCommand } from "./command-support";
import { createUserPromptMessage as createProjectedUserPromptMessage } from "./user-message";
import {
  collectPromptAttachmentIds,
  hydratePromptImageAttachments,
  persistMessageImageAttachments,
  persistPromptImageAttachments,
} from "./attachment-projection";
import { PROMPT_QUEUE_CAPACITY_ERROR_CODE } from "./prompt-queue";

export type SessionPromptRequest = {
  sessionId: string;
  text: string;
  content?: AgentPromptContent[];
  clientMessageId?: string;
};

export type SessionConfigureRequest = {
  sessionId: string;
  agentMode?: string;
  model?: string;
  reasoningEffort?: SessionReasoningEffort;
  configId?: string;
  value?: SessionConfigOptionValue;
};

function logRuntimeDebug(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    context.logger.debug(event, fields);
    return;
  }
  context.logDebug?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logRuntimeInfo(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    context.logger.info(event, fields);
    return;
  }
  context.logInfo?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function logRuntimeError(context: HelmHandlerContext, event: string, fields: Record<string, unknown>) {
  if (context.logger) {
    context.logger.error(event, fields);
    return;
  }
  context.logError?.(`[tiller] ${event} ${formatLogFields(fields)}`);
}

function formatLogFields(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

async function resolvePromptRuntime(
  params: Pick<SessionPromptRequest, "sessionId" | "text">,
  context: HelmHandlerContext,
) {
  let record = context.sessions.get(params.sessionId);
  if (record) {
    return record;
  }

  logRuntimeDebug(context, "runtime.prompt.restore_required", {
    sessionId: params.sessionId,
    chars: params.text.length,
  });
  const restore = await context.startSessionResume(params.sessionId);
  logRuntimeInfo(context, "runtime.prompt.restore_completed", {
    sessionId: params.sessionId,
    ok: restore.ok,
    method: restore.resume.restoreMethod ?? "none",
    messageChars: restore.message.length,
  });
  record = context.sessions.get(params.sessionId);
  return record;
}

type PromptRuntimeRecord = NonNullable<ReturnType<HelmHandlerContext["sessions"]["get"]>>;

async function promptWithRuntimeRecovery(
  sessionId: string,
  record: PromptRuntimeRecord,
  prompt: () => Promise<void>,
  context: HelmHandlerContext,
) {
  try {
    await prompt();
  } catch (error) {
    if (context.sessions.get(sessionId) === record) {
      context.sessions.delete(sessionId);
    }
    throw error;
  }
}

function broadcastPromptQueue(context: HelmHandlerContext, sessionId: string) {
  publishPromptQueueState(sessionId, context.promptQueue.snapshot(sessionId), context);
}

function broadcastPromptFailure(context: HelmHandlerContext, sessionId: string, message: string) {
  context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    status: "error",
    updatedAt: new Date().toISOString(),
    lastMessagePreview: "Prompt failed",
  }));
  createSessionEventPublisher(context).errorRaised({ sessionId, message });
  publishCanonicalSessionStateEvent(sessionId, { type: "status", status: "error" }, context);
}

function subscribePromptingSocketToSession(sessionId: string, context: HelmHandlerContext) {
  if (!context.socketId) {
    return;
  }
  context.subscribeSessionTopic(context.socketId, sessionId);
}

function applyDispatchingUserPromptToSummary(
  current: SessionSummary,
  text: string,
  timestamp: string,
) {
  return {
    ...applyUserPromptToSummary(current, text, timestamp),
    status: "running" as const,
  };
}

export async function sendPromptImmediately(
  item: SessionQueuedPrompt,
  context: HelmHandlerContext,
) {
  const record = await resolvePromptRuntime(item, context);
  if (!record) {
    logRuntimeError(context, "runtime.prompt.send_failed", {
      sessionId: item.sessionId,
      reason: "runtime_not_available",
    });
    throw new Error("Session runtime is not available. Try reconnecting this Mission first.");
  }

  subscribePromptingSocketToSession(item.sessionId, context);

  const imageAttachments = item.content?.filter((content) => content.type === "image") ?? [];
  logRuntimeInfo(context, "runtime.prompt.send_started", {
    sessionId: item.sessionId,
    queued: true,
    chars: item.text.length,
    images: imageAttachments.length,
  });
  emitHelmPromptTrace(context, {
    traceId: item.clientMessageId,
    sessionId: item.sessionId,
    phase: "helm.prompt.send_start",
    meta: { queued: true, chars: item.text.length, images: imageAttachments.length },
  });

  await promptWithRuntimeRecovery(
    item.sessionId,
    record,
    () => record.runtime.prompt(
      item.text,
      hydratePromptImageAttachments({
        sessionId: item.sessionId,
        content: item.content,
        attachments: context.sessionAttachmentStore,
      }),
    ),
    context,
  );
  emitHelmPromptTrace(context, {
    traceId: item.clientMessageId,
    sessionId: item.sessionId,
    phase: "helm.prompt.runtime_accepted",
    meta: { queued: true },
  });
  if (flushLiveAssistantMessage(item.sessionId, context)) {
    logRuntimeDebug(context, "runtime.prompt.flush_after_completion", {
      sessionId: item.sessionId,
      reason: "assistant_buffer_after_prompt_completion",
    });
  }
  return "end_turn" as const;
}

function createUserPromptMessage(
  item: Pick<SessionQueuedPrompt, "sessionId" | "text" | "content" | "clientMessageId"> & { timestamp: string },
  context: HelmHandlerContext,
) {
  return createProjectedUserPromptMessage(item, (sessionId) =>
    allocateLiveEventSequence(sessionId, context)
  );
}

async function appendUserPromptMessage(
  sessionId: string,
  userMessage: ReturnType<typeof createUserPromptMessage>,
  context: HelmHandlerContext,
) {
  const storedUserMessage = persistMessageImageAttachments({
    sessionId,
    message: userMessage,
    attachments: context.sessionAttachmentStore,
  });
  assertCanonicalTimelinePipeline(context);
  const event = { type: "message" as const, message: storedUserMessage };
  const prepared = prepareRuntimeSessionUpdate(
    sessionId,
    event,
    context,
    storedUserMessage.sequence,
  );
  routeSessionRuntimeEvent(sessionId, event, {
    workers: context.sessionTimelineWorkers,
    flushScheduler: context.sessionTimelineFlushScheduler,
    context,
  }, prepared.resolvedSequence, prepared.update);
  const updated = context.updateSessionSummary(sessionId, (current) =>
    applyDispatchingUserPromptToSummary(current, storedUserMessage.text, storedUserMessage.timestamp),
  );
  if (updated) {
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }
}

function assertCanonicalTimelinePipeline(
  context: HelmHandlerContext,
): asserts context is HelmHandlerContext & Required<Pick<
  HelmHandlerContext,
  | "sessionTimelineWorkers"
  | "sessionTimelineDispatcher"
  | "sessionTimelineFlushScheduler"
  | "sessionLiveStateStore"
>> {
  if (
    context.sessionTimelineWorkers &&
      context.sessionTimelineDispatcher &&
      context.sessionTimelineFlushScheduler &&
      context.sessionLiveStateStore
  ) {
    return;
  }
  throw new Error("Canonical runtime services are required.");
}

async function runInFlightPrompt(
  item: SessionQueuedPrompt,
  context: HelmHandlerContext,
) {
  try {
    await sendPromptImmediately(item, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt failed.";
    logRuntimeError(context, "runtime.prompt.inflight_failed", {
      sessionId: item.sessionId,
      messageChars: message.length,
    });
    broadcastPromptFailure(context, item.sessionId, message);
  } finally {
    context.promptQueue.clearInFlight(item.sessionId, item.id);
    broadcastPromptQueue(context, item.sessionId);
    void context.drainPromptQueue(item.sessionId);
  }
}

export async function drainPromptQueue(sessionId: string, context: HelmHandlerContext) {
  if (context.promptQueue.isDraining(sessionId) || context.promptQueue.hasInFlight(sessionId)) {
    return;
  }

  context.promptQueue.setDraining(sessionId, true);
  try {
    while (!context.promptQueue.hasInFlight(sessionId)) {
      const next = context.promptQueue.takeNext(sessionId);
      if (!next) {
        break;
      }
      const inFlight = context.promptQueue.setInFlight(next);
      broadcastPromptQueue(context, sessionId);
      
      // 在发送前先将消息写入聊天
      const timestamp = new Date().toISOString();
      const userMessage = createUserPromptMessage({
        sessionId: next.sessionId,
        text: next.text,
        content: next.content,
        clientMessageId: next.clientMessageId,
        timestamp,
      }, context);
      await appendUserPromptMessage(sessionId, userMessage, context);
      
      try {
        await sendPromptImmediately(inFlight, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Prompt failed.";
        logRuntimeError(context, "runtime.prompt.queue_failed", {
          sessionId,
          messageChars: message.length,
        });
      } finally {
        context.promptQueue.clearInFlight(sessionId, inFlight.id);
        broadcastPromptQueue(context, sessionId);
      }
    }
  } finally {
    context.promptQueue.setDraining(sessionId, false);
  }
}

export async function sendPromptToSession(
  params: SessionPromptRequest,
  context: HelmHandlerContext,
) {
  const record = await resolvePromptRuntime(params, context);
  if (!record) {
    logRuntimeError(context, "runtime.prompt.send_failed", {
      sessionId: params.sessionId,
      reason: "runtime_not_available",
    });
    throw new Error("Session runtime is not available. Try reconnecting this Mission first.");
  }

  const imageAttachments = params.content?.filter((item) => item.type === "image") ?? [];
  if (imageAttachments.length && !record.runtime.sessionCapabilities?.imageInput) {
    const error = new Error(ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE);
    (error as Error & { code?: string }).code = ACP_IMAGE_INPUT_UNSUPPORTED_CODE;
    throw error;
  }

  assertSupportedSlashCommand(
    params.text,
    record.summary?.availableCommands,
    record.summary?.agentName ?? record.agent?.name ?? record.agent?.id ?? "ACP agent",
  );

  subscribePromptingSocketToSession(params.sessionId, context);
  const clientMessageId = params.clientMessageId
    ?? `${params.sessionId}-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingAttachmentIds = new Set(collectPromptAttachmentIds(params.content));
  const promptInput: SessionPromptRequest = {
    ...params,
    clientMessageId,
    ...(params.content?.length
      ? {
          content: persistPromptImageAttachments({
            sessionId: params.sessionId,
            messageId: clientMessageId,
            content: params.content,
            attachments: context.sessionAttachmentStore,
          }),
        }
      : {}),
  };
  const useCase = new SendPromptUseCase<SessionQueuedPrompt, ReturnType<typeof context.promptQueue.snapshot>, ReturnType<typeof createUserPromptMessage>, AgentPromptContent>({
    runtime: {
      prompt: async (input) => {
        const promptContent = input.content as AgentPromptContent[] | undefined;
        const activeRecord = await resolvePromptRuntime(input, context);
        if (!activeRecord) {
          logRuntimeError(context, "runtime.prompt.send_failed", {
            sessionId: input.sessionId,
            reason: "runtime_not_available",
          });
          throw new Error("Session runtime is not available. Try reconnecting this Mission first.");
        }
        logRuntimeInfo(context, "runtime.prompt.send_started", {
          sessionId: input.sessionId,
          queued: false,
          chars: input.text.length,
          images: promptContent?.filter((content) => content.type === "image").length ?? 0,
        });
        emitHelmPromptTrace(context, {
          traceId: input.clientMessageId,
          sessionId: input.sessionId,
          phase: "helm.prompt.send_start",
          meta: {
            queued: false,
            chars: input.text.length,
            images: promptContent?.filter((content) => content.type === "image").length ?? 0,
          },
        });
        await promptWithRuntimeRecovery(
          input.sessionId,
          activeRecord,
          () => activeRecord.runtime.prompt(
            input.text,
            hydratePromptImageAttachments({
              sessionId: input.sessionId,
              content: promptContent,
              attachments: context.sessionAttachmentStore,
            }),
          ),
          context,
        );
        emitHelmPromptTrace(context, {
          traceId: input.clientMessageId,
          sessionId: input.sessionId,
          phase: "helm.prompt.runtime_accepted",
          meta: { queued: false },
        });
        if (flushLiveAssistantMessage(input.sessionId, context)) {
          logRuntimeDebug(context, "runtime.prompt.flush_after_completion", {
            sessionId: input.sessionId,
            reason: "assistant_buffer_after_prompt_completion",
          });
        }
        return { accepted: true, runtimeSessionId: activeRecord.runtime.runtimeSessionId };
      },
    },
    promptQueue: context.promptQueue,
    projector: {
      appendUserMessage: async (sessionId, message) => {
        await appendUserPromptMessage(sessionId, message, context);
      },
    },
    createUserMessage: (item) => createUserPromptMessage(item, context),
    onQueueChanged: (sessionId) => broadcastPromptQueue(context, sessionId),
    onPromptFailed: (sessionId, error) => {
      const message = error instanceof Error ? error.message : "Prompt failed.";
      logRuntimeError(context, "runtime.prompt.inflight_failed", {
        sessionId,
        messageChars: message.length,
      });
      broadcastPromptFailure(context, sessionId, message);
    },
    onPromptSettled: (sessionId, queueItem) => {
      context.promptQueue.clearInFlight(sessionId, queueItem.id);
      broadcastPromptQueue(context, sessionId);
      void context.drainPromptQueue(sessionId);
    },
    shouldQueue: (sessionId) => {
      const summary = context.sessions.get(sessionId)?.summary;
      return summary?.status === "running" || summary?.status === "waiting_for_permission";
    },
  });

  let result;
  try {
    result = await useCase.execute(promptInput);
  } catch (error) {
    if ((error as { code?: string }).code === PROMPT_QUEUE_CAPACITY_ERROR_CODE) {
      for (const attachmentId of collectPromptAttachmentIds(promptInput.content)) {
        if (!existingAttachmentIds.has(attachmentId)) {
          context.sessionAttachmentStore.remove(attachmentId);
        }
      }
    }
    throw error;
  }
  emitHelmPromptTrace(context, {
    traceId: promptInput.clientMessageId,
    sessionId: promptInput.sessionId,
    phase: result.accepted === "queued" ? "helm.prompt.queued" : "helm.prompt.ack",
    meta: { accepted: result.accepted },
  });
  return result;
}

export async function configureSessionRuntime(
  params: SessionConfigureRequest,
  context: HelmHandlerContext,
) {
  const current =
    context.sessions.get(params.sessionId)?.summary ??
    context.sessionStore.get(params.sessionId);
  if (!current) {
    throw new Error("Session not found");
  }

  const activeRecord = context.sessions.get(params.sessionId);
  const runtimeResult = activeRecord
    ? await activeRecord.runtime.configure({
        agentMode: params.agentMode,
        model: params.model,
        reasoningEffort: params.reasoningEffort,
        configId: params.configId,
        value: params.value,
      })
    : null;
  const nextAgentMode = params.agentMode ?? runtimeResult?.state.agentMode ?? current.agentMode;
  const nextModel = params.model ?? runtimeResult?.state.model ?? current.model;
  const nextModelOptions = runtimeResult?.modelState?.options ?? current.modelOptions;
  const resolvedConfigOptions = resolveConfigOptionsForSelection({
    incomingOptions: runtimeResult?.options ?? activeRecord?.runtime.sessionConfigOptions,
    previousOptions: current.configOptions,
    selectedModel: nextModel,
  });
  const nextConfigOptions = resolvedConfigOptions.options ?? current.configOptions ?? [];
  const nextReasoning = resolveConfigReasoningEffortForOptions(
    params.reasoningEffort ?? runtimeResult?.state.reasoningEffort ?? current.reasoningEffort,
    resolvedConfigOptions,
  );
  const updatedAt = new Date().toISOString();
  const next = context.hydrateSessionSummary({
    ...current,
    agentMode: nextAgentMode,
    model: nextModel,
    modelOptions: nextModelOptions,
    configOptions: nextConfigOptions,
    reasoningEffort: nextReasoning,
    updatedAt,
  });
  context.updateSessionSummary(params.sessionId, () => next);
  publishCanonicalSessionStateEvent(
    params.sessionId,
    {
      type: "config-options",
      state: {
        agentMode: nextAgentMode,
        model: nextModel,
        reasoningEffort: nextReasoning,
      },
      options: nextConfigOptions,
    },
    context,
  );
  return {
    sessionId: params.sessionId,
    ok: true,
    state: {
      agentMode: nextAgentMode,
      model: nextModel,
      reasoningEffort: nextReasoning,
    },
    options: nextConfigOptions ?? [],
    message: runtimeResult?.runtimeApplied ? "Session config updated." : "Session config saved.",
  };
}

export async function cancelSessionRuntime(
  sessionId: string,
  context: HelmHandlerContext,
): Promise<boolean> {
  const record = context.sessions.get(sessionId);
  if (!record) {
    createSessionEventPublisher(context).errorRaised({ sessionId, message: "Session not found" });
    return true;
  }

  handleRuntimeEvent(sessionId, {
    type: "status",
    status: "cancelled",
    message: "Cancelled by user",
  }, context);
  record.runtime.cancel();
  context.sessions.delete(sessionId);
  return true;
}
