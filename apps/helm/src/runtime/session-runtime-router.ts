import type { AgentPromptContent, SessionConfigOptionValue, SessionReasoningEffort } from "@tiller/shared";
import {
  ACP_IMAGE_INPUT_UNSUPPORTED_CODE,
  ACP_IMAGE_INPUT_UNSUPPORTED_MESSAGE,
} from "@tiller/shared";
import { applyUserPromptToSummary } from "../sessions/facade";
import { broadcastErrorRaised, broadcastSessionUpdate } from "../rpc/notifications";
import type { HelmHandlerContext } from "../handlers/context";

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

  context.logInfo(
    `[tiller] 阶段=发送Prompt session=${params.sessionId} chars=${params.text.length} images=${imageAttachments.length}`,
  );
  const timestamp = new Date().toISOString();
  const userMessageId = params.clientMessageId || `${params.sessionId}-user-${Date.now()}`;
  context.persistSessionMessage(params.sessionId, {
    id: userMessageId,
    role: "user",
    text: params.text,
    timestamp,
    ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
  });
  const updated = context.updateSessionSummary(params.sessionId, (current) =>
    applyUserPromptToSummary(current, params.text, timestamp),
  );
  if (updated) {
    broadcastSessionUpdate(context, params.sessionId, {
      kind: "session_updated",
      session: updated,
    });
  }

  await record.runtime.prompt(params.text, params.content);
  return { stopReason: "end_turn" };
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
  const nextAgentMode = runtimeResult?.state.agentMode ?? params.agentMode ?? current.agentMode;
  const nextModel = runtimeResult?.state.model ?? params.model;
  const nextReasoning = runtimeResult?.state.reasoningEffort ?? params.reasoningEffort;
  const nextModelOptions = runtimeResult?.modelState?.options ?? current.modelOptions;
  const nextConfigOptions = runtimeResult?.options ?? activeRecord?.runtime.sessionConfigOptions ?? current.configOptions;
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
