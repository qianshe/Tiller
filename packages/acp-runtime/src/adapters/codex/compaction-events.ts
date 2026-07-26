import type { SessionRuntimeEvent } from "../../runtime-types";
import type { AcpCompactionSignalSummary, AcpSessionUpdateProjectionContext } from "../types";

const CODEX_COMPACTION_PREFIX = /^context compacted(?:[.!?。！：:]*)/iu;

export function mapCodexCompactionUpdate(
  context: AcpSessionUpdateProjectionContext,
): Extract<SessionRuntimeEvent, { type: "compaction" }> | null {
  if (!isMessageChunkUpdateType(context.updateType) || !context.text) {
    return null;
  }

  const signal = summarizeCodexCompactionSignal(context.text.trim());
  if (!signal?.exactMatch) {
    return null;
  }

  const update = recordFrom(context.update);
  const message = recordFrom(update.message);
  return {
    type: "compaction",
    phase: "completed",
    source: "provider",
    timestamp: stringFrom(update.timestamp ?? message.timestamp) ?? new Date().toISOString(),
    messageId: stringFrom(update.messageId ?? update.message_id ?? message.id ?? update.id),
  };
}

export function mapCodexCompactionToolUpdate(
  context: AcpSessionUpdateProjectionContext,
): Extract<SessionRuntimeEvent, { type: "compaction" }> | null {
  if (context.updateType !== "tool_call" && context.updateType !== "tool_call_update") {
    return null;
  }

  const update = recordFrom(context.update);
  const source = recordFrom(update.toolCall ?? update.tool_call ?? update.tool);
  const kind = stringFrom(source.kind ?? update.kind)?.trim().toLowerCase();
  if (kind && kind !== "other" && kind !== "tool") {
    return null;
  }
  const title = stringFrom(
    source.title ?? source.label ?? source.displayName ?? source.display_name ??
      update.title ?? update.label ?? update.displayName ?? update.display_name,
  );
  const signal = title ? summarizeCodexCompactionSignal(title.trim()) : null;
  if (!signal?.exactMatch) {
    return null;
  }

  return {
    type: "compaction",
    phase: "completed",
    source: "provider",
    timestamp: stringFrom(source.timestamp ?? update.timestamp) ?? new Date().toISOString(),
    messageId: stringFrom(
      source.id ?? source.toolCallId ?? source.tool_call_id ??
        update.toolCallId ?? update.tool_call_id ?? update.id,
    ),
  };
}

export function summarizeCodexCompactionSignal(text: string): AcpCompactionSignalSummary | null {
  const match = matchCodexCompactionPrefix(text);
  if (!match) {
    return null;
  }
  return {
    kind: "codex_context_compacted_prefix",
    exactMatch: match.trailingText.length === 0,
    hasTrailingText: match.trailingText.length > 0,
  };
}

export function expandCodexRuntimeEvent(
  event: SessionRuntimeEvent,
): SessionRuntimeEvent[] | null {
  if (event.type !== "message" || event.message.role !== "assistant") {
    return null;
  }
  const match = matchCodexCompactionPrefix(event.message.text);
  if (!match) {
    return null;
  }

  const compactionEvent: Extract<SessionRuntimeEvent, { type: "compaction" }> = {
    type: "compaction",
    phase: "completed",
    source: "provider",
    timestamp: event.message.timestamp,
    messageId: `${event.message.id}:compaction-marker`,
  };

  if (!match.trailingText) {
    return [compactionEvent];
  }

  return [
    compactionEvent,
    {
      type: "message",
      message: {
        ...event.message,
        text: match.trailingText,
        streaming: false,
      },
    },
  ];
}

function isMessageChunkUpdateType(updateType: string | undefined) {
  return updateType === "agent_message_chunk" || updateType === "user_message_chunk";
}

function matchCodexCompactionPrefix(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return null;
  }
  const match = CODEX_COMPACTION_PREFIX.exec(normalizedText);
  if (!match) {
    return null;
  }
  return {
    trailingText: normalizedText.slice(match[0].length).trim(),
  };
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}
