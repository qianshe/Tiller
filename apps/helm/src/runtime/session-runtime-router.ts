import type { AgentPromptContent, AvailableCommand, SessionConfigOptionValue, SessionQueuedPrompt, SessionReasoningEffort } from "@tiller/shared";
import {
  ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
  ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
} from "@tiller/shared";
import { applyUserPromptToSummary } from "../sessions/facade";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../rpc/notifications";
import { flushLiveAssistantMessage } from "./events";
import type { HelmHandlerContext } from "../handlers/context";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";

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

function parseSlashCommandName(text: string) {
  const match = /^\s*\/(\S+)/u.exec(text);
  return match?.[1]?.replace(/^\/+/, "") ?? null;
}

function availableCommandInvocations(command: AvailableCommand) {
  const name = command.name.replace(/^\/+/, "");
  const scope = command.scope?.trim();
  return scope ? [name, `${scope}:${name}`] : [name];
}

function assertSupportedSlashCommand(text: string, commands: AvailableCommand[] | undefined, agentName: string) {
  const commandName = parseSlashCommandName(text);
  if (!commandName || !commands?.length) {
    return;
  }
  const supported = commands.some((command) => availableCommandInvocations(command).includes(commandName));
  if (supported) {
    return;
  }
  const available = commands.map((command) => `/${availableCommandInvocations(command).at(-1)}`).join(", ");
  throw new Error(`/${commandName} command is not supported by ${agentName}. Available commands: ${available}`);
}

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
  broadcastSessionUpdate(context, sessionId, {
    kind: "prompt_queue",
    queue: context.promptQueue.snapshot(sessionId),
  });
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
  const timestamp = new Date().toISOString();
  const userMessage = {
    id: item.clientMessageId,
    role: "user" as const,
    text: item.text,
    timestamp,
    ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
  };
  context.persistSessionMessage(item.sessionId, userMessage);
  broadcastSessionUpdate(context, item.sessionId, {
    kind: "user_message",
    message: userMessage,
  });
  const updated = context.updateSessionSummary(item.sessionId, (current) =>
    applyUserPromptToSummary(current, item.text, timestamp),
  );
  if (updated) {
    broadcastSessionUpdate(context, item.sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }

  await record.runtime.prompt(item.text, item.content);
  if (flushLiveAssistantMessage(item.sessionId, context)) {
    context.logInfo(
      `[tiller] 阶段=Prompt完成兜底落盘 session=${item.sessionId} reason=assistant_buffer_after_prompt_completion`,
    );
  }
  return "end_turn" as const;
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
    broadcastErrorRaised(context, { sessionId: item.sessionId, message });
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

  const clientMessageId = params.clientMessageId || `${params.sessionId}-user-${Date.now()}`;
  if (context.promptQueue.hasInFlight(params.sessionId)) {
    const queueItem = context.promptQueue.enqueue({
      sessionId: params.sessionId,
      text: params.text,
      content: params.content,
      clientMessageId,
    });
    broadcastPromptQueue(context, params.sessionId);
    return { accepted: "queued" as const, queueItem };
  }

  const inFlight = context.promptQueue.markInFlight({
    sessionId: params.sessionId,
    text: params.text,
    content: params.content,
    clientMessageId,
  });
  broadcastPromptQueue(context, params.sessionId);
  void runInFlightPrompt(inFlight, context);
  return { accepted: "sent" as const };
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
  broadcastSessionUpdate(context, params.sessionId, { kind: "session_updated", session: next });
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
    broadcastErrorRaised(context, { sessionId, message: "Session not found" });
    return true;
  }

  record.runtime.cancel();
  context.sessions.delete(sessionId);
  return true;
}
