export function shouldStartNewRuntimeAssistantSegment(currentText: string, incomingText: string) {
  if (!currentText || !incomingText) {
    return false;
  }
  if (incomingText.startsWith(currentText) || currentText.endsWith(incomingText)) {
    return false;
  }
  if (isProviderDiagnosticAssistantText(currentText) !== isProviderDiagnosticAssistantText(incomingText)) {
    return true;
  }
  return false;
}

export function isProviderDiagnosticAssistantText(text: string) {
  return /^Model metadata for\b/u.test(text.trim());
}

export function mergeAssistantStreamText(currentText: string, incomingText: string) {
  if (!currentText || incomingText.startsWith(currentText)) {
    return incomingText || currentText;
  }
  if (currentText.endsWith(incomingText)) {
    return currentText;
  }
  return `${currentText}${incomingText}`;
}

export function isRuntimeGeneratedMessageId(id: string) {
  return /^(?:session-[\w-]+|[0-9a-f]{8,}(?:-[0-9a-f]{4,}){2,})-msg-(?:[a-z0-9]+|\d{6}-\d{6}-[pc][a-z0-9]{1,32})$/iu.test(id);
}

type BroadcastToolCallLike = {
  kind?: string;
  title?: string;
  id?: string;
  status: unknown;
  updatedAt?: string;
  output?: unknown;
  input?: unknown;
};

export function resolveBroadcastToolCall<T extends BroadcastToolCallLike>(
  incoming: T,
  persisted: T | undefined,
): T {
  if (!persisted) {
    return incoming;
  }
  return {
    ...persisted,
    kind: resolveBroadcastToolCallKind(persisted.kind, incoming.kind),
    title: resolveBroadcastToolCallTitle(
      persisted.title,
      incoming.title,
      incoming.id ?? persisted.id,
    ),
    status: incoming.status,
    updatedAt: incoming.updatedAt,
    ...(incoming.output !== undefined ? { output: incoming.output } : {}),
    ...(incoming.input !== undefined ? { input: incoming.input } : {}),
  };
}

function resolveBroadcastToolCallKind(
  currentKind: string | undefined,
  incomingKind: string | undefined,
) {
  if (!incomingKind) {
    return currentKind;
  }
  if (!currentKind) {
    return incomingKind;
  }
  if (currentKind === "shell" && incomingKind === "search") {
    return incomingKind;
  }
  return toolCallKindRank(incomingKind) > toolCallKindRank(currentKind)
    ? incomingKind
    : currentKind;
}

function resolveBroadcastToolCallTitle(
  currentTitle: string | undefined,
  incomingTitle: string | undefined,
  id: string | undefined,
) {
  if (isInformativeToolCallTitle(incomingTitle, id)) {
    return incomingTitle;
  }
  return currentTitle ?? incomingTitle;
}

function isInformativeToolCallTitle(title: string | undefined, id: string | undefined) {
  const normalized = title?.trim();
  return Boolean(
    normalized &&
      normalized !== id &&
      !/^call_[A-Za-z0-9]+$/u.test(normalized) &&
      !/^Tool call\b/u.test(normalized),
  );
}

function toolCallKindRank(kind: string | undefined) {
  switch (kind) {
    case "mcp":
      return 4;
    case "read":
    case "write":
    case "search":
    case "shell":
    case "skill":
    case "subagent":
      return 3;
    case "think":
    case "todo":
    case "fetch":
      return 2;
    case "tool":
      return 1;
    default:
      return 0;
  }
}

export function oneLine(value: string, maxLength = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function formatLogValue(value: unknown, maxLength = 220) {
  if (typeof value === "string") {
    return oneLine(value, maxLength);
  }
  try {
    return oneLine(JSON.stringify(value), maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}
