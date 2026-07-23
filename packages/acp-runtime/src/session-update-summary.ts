import { looksLikeContinuationSummary } from "@tiller/shared";
import { summarizeAdapterCompactionSignal } from "./adapters";
import { isCompactionRelatedUpdateType, summarizeLifecycleCompactionPhase } from "./compaction-events";
import type { SessionRuntimeEvent } from "./runtime-types";
import {
  extractTextContent,
  recordFrom,
  resolveSessionUpdateType,
  serializableStringFrom,
} from "./session-update";

export function summarizeSessionUpdateNotification(
  params: unknown,
  mappedEventType?: SessionRuntimeEvent["type"],
  options: { providerId?: string } = {},
) {
  const paramsRecord = recordFrom(params);
  const update = recordFrom(paramsRecord.update);
  const sessionId = serializableStringFrom(paramsRecord.sessionId ?? paramsRecord.session_id);
  const updateType = resolveSessionUpdateType(update);
  const content = update.content ?? update.delta ?? update.message;
  const text = extractTextContent(content);
  const compactionProbe = summarizeCompactionProbe({
    providerId: options.providerId,
    updateType,
    text,
    mappedEventType,
  });
  return {
    sessionId,
    updateType,
    updateKeys: objectKeys(update),
    contentShape: describeContentShape(content),
    mappedEventType: mappedEventType ?? null,
    ...(compactionProbe ? { compactionProbe } : {}),
  };
}

function summarizeCompactionProbe(args: {
  providerId?: string;
  updateType?: string;
  text: string | null;
  mappedEventType?: SessionRuntimeEvent["type"];
}) {
  const normalizedText = args.text?.trim() || "";
  const matchedLifecyclePhase = normalizedText ? summarizeLifecycleCompactionPhase(normalizedText) : null;
  const matchedContinuationSummary = normalizedText ? looksLikeContinuationSummary(normalizedText) : false;
  const providerSignal = normalizedText ? summarizeAdapterCompactionSignal(args.providerId, normalizedText) : null;
  const updateTypeCompactionRelated = isCompactionRelatedUpdateType(args.updateType);
  if (!matchedLifecyclePhase && !matchedContinuationSummary && !providerSignal &&
      !updateTypeCompactionRelated && args.mappedEventType !== "compaction") {
    return null;
  }
  return {
    textChars: normalizedText.length,
    updateTypeCompactionRelated,
    matchedLifecyclePhase,
    matchedContinuationSummary,
    ...(providerSignal ? { providerSignal } : {}),
  };
}

function objectKeys(value: unknown): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
}

function describeContentShape(content: unknown): unknown {
  if (typeof content === "string") {
    return { kind: "string", chars: content.length };
  }
  if (Array.isArray(content)) {
    return {
      kind: "array",
      length: content.length,
      itemShapes: content.slice(0, 5).map((item) => describeContentShape(item)),
    };
  }
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    return {
      kind: "object",
      type: typeof record.type === "string" ? record.type : undefined,
      keys: Object.keys(record).sort(),
    };
  }
  return content == null ? null : { kind: typeof content };
}
