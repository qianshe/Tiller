import { randomUUID } from "node:crypto";
import type { ConversationPreparation, SessionReasoningEffort } from "@tiller/shared";
import { broadcastConversationUpdate, broadcastErrorRaised, broadcastSessionUpdate } from "../../rpc/notifications";
import type { HelmHandlerContext } from "../context";
import { createSession } from "../sessions/session-create-rpc";
import { promptSession } from "../sessions/prompt-rpc";
import { validateConversationPreparationContent } from "@tiller/persistence";

type PreparationFields = {
  content?: string;
  title?: string | null;
  projectId?: string | null;
  cwd?: string | null;
  agentId?: string | null;
  agentMode?: string | null;
  model?: string | null;
  reasoningEffort?: SessionReasoningEffort | null;
};

export type ConversationRpcDependencies = {
  createSession: typeof createSession;
  promptSession: typeof promptSession;
};

const DEFAULT_DEPENDENCIES: ConversationRpcDependencies = {
  createSession,
  promptSession,
};

const startLocks = new Map<string, Promise<unknown>>();

export async function handleConversationRpcRequest(
  method: string,
  params: unknown,
  context: HelmHandlerContext,
  dependencies: ConversationRpcDependencies = DEFAULT_DEPENDENCIES,
): Promise<unknown | undefined> {
  if (!method.startsWith("conversation/")) {
    return undefined;
  }
  const store = context.conversationPreparationStore;
  if (!store) {
    throw new Error("Conversation preparation store is unavailable");
  }
  switch (method) {
    case "conversation/list":
      return { preparations: store.list() };
    case "conversation/save":
      return savePreparation(params as PreparationFields & { id?: string; revision?: number }, context);
    case "conversation/delete":
      return deletePreparation(params as { id: string; revision?: number }, context);
    case "conversation/start":
      return startConversation(params as PreparationFields & {
        preparationId?: string;
        revision?: number;
      }, context, dependencies);
    default:
      return undefined;
  }
}

function preparationStore(context: HelmHandlerContext) {
  if (!context.conversationPreparationStore) {
    throw new Error("Conversation preparation store is unavailable");
  }
  return context.conversationPreparationStore;
}

function savePreparation(
  params: PreparationFields & { id?: string; revision?: number },
  context: HelmHandlerContext,
) {
  const store = preparationStore(context);
  const current = params.id ? store.get(params.id) : undefined;
  if (params.id && !current) {
    throw new Error("Conversation preparation not found");
  }
  if (current && params.revision === undefined) {
    throw new Error("Conversation preparation revision is required");
  }
  if (current && params.revision !== undefined && params.revision !== current.revision) {
    throw new Error("Conversation preparation revision conflict");
  }
  const now = new Date().toISOString();
  const preparation: ConversationPreparation = {
    id: current?.id ?? params.id ?? `preparation-${randomUUID()}`,
    content: validateConversationPreparationContent(params.content ?? current?.content ?? ""),
    ...(valueOrPrevious(params.title, current?.title) ? { title: valueOrPrevious(params.title, current?.title) } : {}),
    ...(valueOrPrevious(params.projectId, current?.projectId) ? { projectId: valueOrPrevious(params.projectId, current?.projectId) } : {}),
    ...(valueOrPrevious(params.cwd, current?.cwd) ? { cwd: valueOrPrevious(params.cwd, current?.cwd) } : {}),
    ...(valueOrPrevious(params.agentId, current?.agentId) ? { agentId: valueOrPrevious(params.agentId, current?.agentId) } : {}),
    ...(valueOrPrevious(params.agentMode, current?.agentMode) ? { agentMode: valueOrPrevious(params.agentMode, current?.agentMode) } : {}),
    ...(valueOrPrevious(params.model, current?.model) ? { model: valueOrPrevious(params.model, current?.model) } : {}),
    ...(params.reasoningEffort === null
      ? {}
      : params.reasoningEffort !== undefined
        ? { reasoningEffort: params.reasoningEffort }
        : current?.reasoningEffort
          ? { reasoningEffort: current.reasoningEffort }
          : {}),
    revision: current ? current.revision + 1 : 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  store.upsert(preparation);
  broadcastConversationUpdate(context, { kind: "preparation_updated", preparation });
  return { preparation };
}

function deletePreparation(params: { id: string; revision?: number }, context: HelmHandlerContext) {
  const store = preparationStore(context);
  const current = store.get(params.id);
  if (!current) {
    throw new Error("Conversation preparation not found");
  }
  if (params.revision !== undefined && params.revision !== current.revision) {
    throw new Error("Conversation preparation revision conflict");
  }
  store.remove(params.id);
  broadcastConversationUpdate(context, { kind: "preparation_deleted", preparationId: params.id });
  return { ok: true, preparationId: params.id };
}

async function startConversation(
  params: PreparationFields & { preparationId?: string; revision?: number },
  context: HelmHandlerContext,
  dependencies: ConversationRpcDependencies,
) {
  const store = preparationStore(context);
  const preparation = params.preparationId ? store.get(params.preparationId) : undefined;
  const lockKey = preparation?.id ?? `direct-${randomUUID()}`;
  const existingLock = startLocks.get(lockKey);
  if (existingLock) {
    throw new Error("Conversation preparation is already starting");
  }
  const task = startConversationOnce(params, preparation, context, dependencies);
  startLocks.set(lockKey, task);
  try {
    return await task;
  } finally {
    startLocks.delete(lockKey);
  }
}

async function startConversationOnce(
  params: PreparationFields & { preparationId?: string; revision?: number },
  preparation: ConversationPreparation | undefined,
  context: HelmHandlerContext,
  dependencies: ConversationRpcDependencies,
) {
  if (params.preparationId && !preparation) {
    throw new Error("Conversation preparation not found");
  }
  if (preparation && params.revision === undefined) {
    throw new Error("Conversation preparation revision is required");
  }
  if (preparation && params.revision !== undefined && params.revision !== preparation.revision) {
    throw new Error("Conversation preparation revision conflict");
  }
  const source = {
    content: params.content ?? preparation?.content,
    title: params.title === undefined ? preparation?.title : params.title,
    projectId: params.projectId === undefined ? preparation?.projectId : params.projectId,
    cwd: params.cwd === undefined ? preparation?.cwd : params.cwd,
    agentId: params.agentId === undefined ? preparation?.agentId : params.agentId,
    agentMode: params.agentMode === undefined ? preparation?.agentMode : params.agentMode,
    model: params.model === undefined ? preparation?.model : params.model,
    reasoningEffort: params.reasoningEffort === undefined
      ? preparation?.reasoningEffort
      : params.reasoningEffort,
  };
  const projectId = nonEmpty(source.projectId);
  const agentId = nonEmpty(source.agentId);
  const content = validateConversationPreparationContent(source.content ?? "");
  if (!projectId || !agentId) {
    throw new Error("Project and agent are required to start a conversation");
  }
  const projects = await context.loadAvailableProjectsWithSemanticSummaries();
  const project = context.resolveProjectById(projectId, projects);
  const cwd = nonEmpty(source.cwd) ?? project?.worktrees?.[0]?.path ?? project?.path;
  if (!project || !cwd) {
    throw new Error("Project and workspace are required to start a conversation");
  }
  const created = await dependencies.createSession({
    projectId,
    cwd,
    agentId,
    agentMode: nonEmpty(source.agentMode),
    model: nonEmpty(source.model),
    reasoningEffort: source.reasoningEffort ?? undefined,
  }, context);
  let result: Awaited<ReturnType<typeof promptSession>>;
  try {
    result = await dependencies.promptSession({
      sessionId: created.session.id,
      text: content,
      content: [{ type: "text", text: content }],
    }, context);
  } catch (error) {
    broadcastErrorRaised(context, {
      sessionId: created.session.id,
      code: "CONVERSATION_START_PROMPT_FAILED",
      message: error instanceof Error ? error.message : String(error),
      source: "conversation",
    });
    throw error;
  }
  const title = nonEmpty(source.title);
  let titleUpdateFailed: string | undefined;
  if (title) {
    try {
      const titled = context.updateSessionSummary(created.session.id, (summary) => ({
        ...summary,
        title,
        updatedAt: new Date().toISOString(),
      }));
      if (titled) {
        broadcastSessionUpdate(context, created.session.id, { kind: "session_updated", session: titled });
      } else {
        titleUpdateFailed = "Session title could not be updated";
      }
    } catch (error) {
      titleUpdateFailed = error instanceof Error ? error.message : String(error);
    }
  }
  if (preparation) {
    const current = preparationStore(context).get(preparation.id);
    if (current?.revision === preparation.revision) {
      preparationStore(context).remove(preparation.id);
      broadcastConversationUpdate(context, { kind: "preparation_deleted", preparationId: preparation.id });
    }
  }
  return {
    ...result,
    session: context.sessions.get(created.session.id)?.summary ?? created.session,
    preparationId: preparation?.id,
    ...(titleUpdateFailed ? { titleUpdateFailed } : {}),
  };
}

function nonEmpty(value: string | null | undefined) {
  return value?.trim() || undefined;
}

function valueOrPrevious(value: string | null | undefined, previous: string | undefined) {
  return value === null ? undefined : value ?? previous;
}
