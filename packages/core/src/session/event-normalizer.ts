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
    // ACP adapters assign the category once. Later snapshots only enrich the
    // same entity; they must not create a second classification truth.
    kind: persisted.kind ?? incoming.kind,
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
