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
import { applyUserPromptToSummary } from "../sessions/facade";
import { createSessionEventPublisher } from "./session-event-publisher";
import { allocateLiveEventSequence, flushLiveAssistantMessage } from "./events";
import type { HelmHandlerContext } from "../handlers/context";
import { emitHelmPromptTrace } from "./prompt-trace";
import { persistTimelineMessage } from "./session-timeline-effects";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";
import { assertSupportedSlashCommand } from "./session-command-support";
import { createUserPromptMessage as createProjectedUserPromptMessage } from "./session-user-message";

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

async function resolvePromptRuntime(
  params: Pick<SessionPromptRequest, "sessionId" | "text">,
  context: HelmHandlerContext,
) {
  let record = context.sessions.get(params.sessionId);
  if (record) {
    return record;
  }

  context.logInfo(
    `[tiller] 阶段=发送前需要恢复 session=${params.sessionId} chars=${params.text.length}`,
  );
  const restore = await context.startSessionResume(params.sessionId);
  context.logInfo(
    `[tiller] 阶段=发送前恢复完成 session=${params.sessionId} ok=${restore.ok} method=${restore.resume.restoreMethod ?? "none"} message=${restore.message}`,
  );
  record = context.sessions.get(params.sessionId);
  return record;
}

function broadcastPromptQueue(context: HelmHandlerContext, sessionId: string) {
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "prompt_queue",
    queue: context.promptQueue.snapshot(sessionId),
  });
}

function broadcastPromptFailure(context: HelmHandlerContext, sessionId: string, message: string) {
  context.updateSessionSummary(sessionId, (current) => ({
    ...current,
    status: "error",
    updatedAt: new Date().toISOString(),
    lastMessagePreview: "Prompt failed",
  }));
  createSessionEventPublisher(context).errorRaised({ sessionId, message });
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "status_change",
    status: "error",
    message,
  });
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
    context.logError(
      `[tiller] 阶段=发送失败 session=${item.sessionId} reason=Session runtime not available`,
    );
    throw new Error("Session runtime is not available. Try reconnecting this Mission first.");
  }

  const imageAttachments = item.content?.filter((content) => content.type === "image") ?? [];
  context.logInfo(
    `[tiller] 阶段=发送Prompt session=${item.sessionId} chars=${item.text.length} images=${imageAttachments.length}`,
  );
  emitHelmPromptTrace(context, {
    traceId: item.clientMessageId,
    sessionId: item.sessionId,
    phase: "helm.prompt.send_start",
    meta: { queued: true, chars: item.text.length, images: imageAttachments.length },
  });
  const timestamp = new Date().toISOString();
  const userMessage = {
    id: item.clientMessageId,
    role: "user" as const,
    text: item.text,
    timestamp,
    timelineSequence: allocateLiveEventSequence(item.sessionId),
    ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
  };
  context.persistSessionMessage(item.sessionId, userMessage);
  persistTimelineMessage(context, item.sessionId, userMessage);
  createSessionEventPublisher(context).sessionUpdate(item.sessionId, {
    kind: "user_message",
    message: userMessage,
  });
  const updated = context.updateSessionSummary(item.sessionId, (current) =>
    applyDispatchingUserPromptToSummary(current, item.text, timestamp),
  );
  if (updated) {
    createSessionEventPublisher(context).sessionUpdate(item.sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }

  await record.runtime.prompt(item.text, item.content);
  emitHelmPromptTrace(context, {
    traceId: item.clientMessageId,
    sessionId: item.sessionId,
    phase: "helm.prompt.runtime_accepted",
    meta: { queued: true },
  });
  if (flushLiveAssistantMessage(item.sessionId, context)) {
    context.logInfo(
      `[tiller] 阶段=Prompt完成兜底落盘 session=${item.sessionId} reason=assistant_buffer_after_prompt_completion`,
    );
  }
  return "end_turn" as const;
}

function createUserPromptMessage(
  item: Pick<SessionQueuedPrompt, "sessionId" | "text" | "content" | "clientMessageId"> & { timestamp: string },
) {
  return createProjectedUserPromptMessage(item, allocateLiveEventSequence);
}

async function appendUserPromptMessage(
  sessionId: string,
  userMessage: ReturnType<typeof createUserPromptMessage>,
  context: HelmHandlerContext,
) {
  context.persistSessionMessage(sessionId, userMessage);
  persistTimelineMessage(context, sessionId, userMessage);
  createSessionEventPublisher(context).sessionUpdate(sessionId, {
    kind: "user_message",
    message: userMessage,
  });
  const updated = context.updateSessionSummary(sessionId, (current) =>
    applyDispatchingUserPromptToSummary(current, userMessage.text, userMessage.timestamp),
  );
  if (updated) {
    createSessionEventPublisher(context).sessionUpdate(sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }
}

async function runInFlightPrompt(
  item: SessionQueuedPrompt,
  context: HelmHandlerContext,
) {
  try {
    await sendPromptImmediately(item, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt failed.";
    context.logError(`[tiller] prompt.inflight failed session=${item.sessionId} message=${message}`);
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
      try {
        await sendPromptImmediately(inFlight, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Prompt failed.";
        context.logError(`[tiller] prompt.queue failed session=${sessionId} message=${message}`);
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
    context.logError(
      `[tiller] 阶段=发送失败 session=${params.sessionId} reason=Session runtime not available`,
    );
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

  const useCase = new SendPromptUseCase<SessionQueuedPrompt, ReturnType<typeof context.promptQueue.snapshot>, ReturnType<typeof createUserPromptMessage>, AgentPromptContent>({
    runtime: {
      prompt: async (input) => {
        const promptContent = input.content as AgentPromptContent[] | undefined;
        const activeRecord = await resolvePromptRuntime(input, context);
        if (!activeRecord) {
          context.logError(
            `[tiller] 阶段=发送失败 session=${input.sessionId} reason=Session runtime not available`,
          );
          throw new Error("Session runtime is not available. Try reconnecting this Mission first.");
        }
        context.logInfo(
          `[tiller] 阶段=发送Prompt session=${input.sessionId} chars=${input.text.length} images=${promptContent?.filter((content) => content.type === "image").length ?? 0}`,
        );
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
        await activeRecord.runtime.prompt(input.text, promptContent);
        emitHelmPromptTrace(context, {
          traceId: input.clientMessageId,
          sessionId: input.sessionId,
          phase: "helm.prompt.runtime_accepted",
          meta: { queued: false },
        });
        if (flushLiveAssistantMessage(input.sessionId, context)) {
          context.logInfo(
            `[tiller] 阶段=Prompt完成兜底落盘 session=${input.sessionId} reason=assistant_buffer_after_prompt_completion`,
          );
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
    createUserMessage: createUserPromptMessage,
    onQueueChanged: (sessionId) => broadcastPromptQueue(context, sessionId),
    onPromptFailed: (sessionId, error) => {
      const message = error instanceof Error ? error.message : "Prompt failed.";
      context.logError(`[tiller] prompt.inflight failed session=${sessionId} message=${message}`);
      broadcastPromptFailure(context, sessionId, message);
    },
    onPromptSettled: (sessionId, queueItem) => {
      context.promptQueue.clearInFlight(sessionId, queueItem.id);
      broadcastPromptQueue(context, sessionId);
      void context.drainPromptQueue(sessionId);
    },
  });

  const result = await useCase.execute(params);
  emitHelmPromptTrace(context, {
    traceId: params.clientMessageId,
    sessionId: params.sessionId,
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
    context.sessionStore.list().find((item: any) => item.id === params.sessionId);
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
  const nextConfigOptions = resolvedConfigOptions.options;
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
  createSessionEventPublisher(context).sessionUpdate(params.sessionId, { kind: "session_updated", session: next });
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

  record.runtime.cancel();
  context.sessions.delete(sessionId);
  return true;
}
