import { collectHistoryImageAttachments } from "../history-content";
import {
  normalizeHistoryMessageRole,
  stringFrom,
  type HistoryEvent,
  type HistoryMessageEvent,
} from "../history-events";

const CODEX_DUPLICATE_HISTORY_MESSAGE_WINDOW_MS = 100;

type VisibleCodexHistoryMessagePayloadOptions = {
  fallbackId: string;
  timestamp: string;
};

export function visibleCodexHistoryMessageEventFromPayload(
  payload: unknown,
  options: VisibleCodexHistoryMessagePayloadOptions,
): HistoryMessageEvent | null {
  const record = recordFrom(payload);
  if (!record) {
    return null;
  }

  const role = normalizeHistoryMessageRole(record.role) ??
    roleFromVisibleCodexHistoryMessageType(record.type);
  if (!role) {
    return null;
  }

  const id = firstString(
    record.id,
    record.message_id,
    record.messageId,
    record.client_id,
    record.clientId,
  ) ?? options.fallbackId;
  const text = firstString(record.message, record.text) ||
    collectVisibleCodexHistoryText(record.content) ||
    collectVisibleCodexHistoryText(record.text_elements);
  const attachments = collectHistoryImageAttachments(
    [
      ...arrayFrom(record.content),
      ...arrayFrom(record.images),
      ...arrayFrom(record.local_images),
    ],
    id,
  );

  if (!text && !attachments.length) {
    return null;
  }
  return {
    kind: "message",
    id,
    role,
    ...(text ? { text } : {}),
    timestamp: options.timestamp,
    ...(attachments.length ? { attachments } : {}),
  };
}

export function appendCodexHistoryMessageEvent(
  events: HistoryEvent[],
  event: HistoryMessageEvent,
) {
  const attachments = event.attachments?.length ? event.attachments : [];
  const text = event.text ?? "";
  if (!text && !attachments.length) {
    return false;
  }
  const normalized: HistoryMessageEvent = {
    kind: "message",
    id: event.id,
    role: event.role,
    timestamp: event.timestamp,
    ...(text ? { text } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
  if (hasDuplicateCodexHistoryMessageEvent(events, normalized)) {
    return false;
  }
  events.push(normalized);
  return true;
}

function hasDuplicateCodexHistoryMessageEvent(
  events: HistoryEvent[],
  candidate: HistoryMessageEvent,
) {
  const candidateText = candidate.text ?? "";
  const candidateAttachments = historyMessageAttachmentSignature(candidate.attachments);
  return events.some((event) => (
    event.kind === "message" &&
    event.role === candidate.role &&
    (event.text ?? "") === candidateText &&
    historyMessageAttachmentSignature(event.attachments) === candidateAttachments &&
    isNearHistoryMessageTimestamp(
      event.timestamp,
      candidate.timestamp,
      CODEX_DUPLICATE_HISTORY_MESSAGE_WINDOW_MS,
    )
  ));
}

function isNearHistoryMessageTimestamp(left: string, right: string, duplicateWindowMs: number) {
  if (left === right) {
    return true;
  }
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    Math.abs(leftTime - rightTime) <= duplicateWindowMs;
}

function historyMessageAttachmentSignature(attachments: HistoryMessageEvent["attachments"]) {
  return (attachments ?? [])
    .map((attachment) => [
      attachment.type,
      attachment.mimeType,
      attachment.data,
      attachment.uri ?? "",
      attachment.name ?? "",
    ].join("\u001e"))
    .join("\u001d");
}

function roleFromVisibleCodexHistoryMessageType(type: unknown): HistoryMessageEvent["role"] | null {
  switch (stringFrom(type)) {
    case "user_message":
      return "user";
    case "agent_message":
    case "assistant_message":
      return "assistant";
    case "system_message":
      return "system";
    default:
      return null;
  }
}

function collectVisibleCodexHistoryText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => typeof part === "string" ? part : stringFrom(recordFrom(part)?.text))
    .filter(Boolean)
    .join("");
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string");
}

function arrayFrom(value: unknown) {
  return Array.isArray(value) ? value : [];
}
