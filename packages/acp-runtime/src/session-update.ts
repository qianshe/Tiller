export type UnknownRecord = Record<string, unknown>;

export type SessionUpdateEnvelope = {
  sessionId: string;
  updateType: string | undefined;
  update: UnknownRecord;
  text: string | null;
};

export function parseSessionUpdateNotification(payload: unknown): SessionUpdateEnvelope | null {
  const notification = recordFrom(payload);
  if (notification.method !== "session/update") {
    return null;
  }
  const params = recordFrom(notification.params);
  const sessionId = primitiveStringFrom(params.sessionId ?? params.session_id);
  const update = recordFrom(params.update);
  if (!sessionId || !Object.keys(update).length) {
    return null;
  }
  return {
    sessionId,
    updateType: resolveSessionUpdateType(update),
    update,
    text: extractTextContent(update.content) ??
      extractTextContent(update.delta) ??
      extractTextContent(update.message),
  };
}

export function resolveSessionUpdateType(update: unknown): string | undefined {
  const record = recordFrom(update);
  return primitiveStringFrom(record.sessionUpdate ?? record.session_update ?? record.type);
}

export function isMessageChunkUpdateType(updateType: string | undefined): boolean {
  return updateType === "agent_message_chunk" || updateType === "user_message_chunk";
}

export function isToolCallUpdateType(updateType: string | undefined): boolean {
  return updateType === "tool_call" || updateType === "tool_call_update";
}

export function isToolOrTerminalUpdateType(updateType: string | undefined): boolean {
  const type = updateType?.trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase() ?? "";
  return /(?:^|[_-])(?:command|tool|terminal)(?:$|[_-])/.test(type);
}

export function extractTextContent(content: unknown): string | null {
  if (!content) {
    return null;
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => extractTextContent(item))
      .filter((part): part is string => Boolean(part));
    return joinTextContentBlocks(parts);
  }
  const record = recordFrom(content);
  if (record.type === "text" && typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.text === "string") {
    return record.text;
  }
  if (typeof record.content === "string") {
    return record.content;
  }
  return extractTextContent(record.content);
}

export function joinTextContentBlocks(parts: string[]): string | null {
  if (!parts.length) {
    return null;
  }
  return parts.reduce((text, part) => {
    if (!text) {
      return part;
    }
    if (/\s$/u.test(text) || /^\s/u.test(part)) {
      return `${text}${part}`;
    }
    return `${text}\n\n${part}`;
  }, "");
}

export function recordFrom(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

export function primitiveStringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function serializableStringFrom(value: unknown): string | undefined {
  const primitive = primitiveStringFrom(value);
  if (primitive !== undefined) {
    return primitive;
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
