import type {
  AgentMessage,
  AvailableCommand,
  CommandChunk,
  SessionSummary,
} from "@tiller/shared";

export function availableCommandListsEqual(
  left: AvailableCommand[] | undefined,
  right: AvailableCommand[],
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b) {
      return false;
    }
    if (
      a.name !== b.name ||
      a.description !== b.description ||
      a.input?.hint !== b.input?.hint
    ) {
      return false;
    }
  }
  return true;
}

export function removeSessionRecord<T>(
  records: Record<string, T>,
  sessionId: string,
) {
  const { [sessionId]: _removed, ...rest } = records;
  return rest;
}

export function mergeSessionSummaries(
  current: SessionSummary[],
  incoming: SessionSummary[],
) {
  const byId = new Map(
    current.map((session) => [session.id, session] as const),
  );
  incoming.forEach((session) => byId.set(session.id, session));
  return Array.from(byId.values()).sort((left, right) => {
    const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    const createdDelta = right.createdAt.localeCompare(left.createdAt);
    return createdDelta === 0 ? left.id.localeCompare(right.id) : createdDelta;
  });
}

export function stripRedundantAttachmentData(message: AgentMessage): AgentMessage {
  if (!message.attachments?.length) {
    return message;
  }
  const needsStrip = message.attachments.some(
    (att) => att.data && (att.uri || att.attachmentId),
  );
  if (!needsStrip) {
    return message;
  }
  return {
    ...message,
    attachments: message.attachments.map((att) => {
      if (att.data && (att.uri || att.attachmentId)) {
        const { data: _, ...rest } = att;
        return rest;
      }
      return att;
    }),
  };
}

export function mergeCommandHistory(
  current: CommandChunk[],
  incoming: CommandChunk[],
) {
  const merged = [...current];
  for (const chunk of incoming) {
    if (!merged.some((item) => item.id === chunk.id)) {
      merged.push(chunk);
    }
  }

  return merged.sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp),
  );
}

export function upsertSessionSummary(
  current: SessionSummary[],
  incoming: SessionSummary,
) {
  const previous = current.find((session) => session.id === incoming.id);
  const next = previous
    ? {
        ...incoming,
        model: incoming.model ?? previous.model,
        agentMode: incoming.agentMode ?? previous.agentMode,
        reasoningEffort: incoming.reasoningEffort ?? previous.reasoningEffort,
        modelOptions: incoming.modelOptions ?? previous.modelOptions,
        configOptions: incoming.configOptions ?? previous.configOptions,
        availableCommands: incoming.availableCommands ?? previous.availableCommands,
      }
    : incoming;
  return [
    ...current.filter((session) => session.id !== incoming.id),
    next,
  ].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
}
