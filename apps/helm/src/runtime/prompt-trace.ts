import type { PromptTraceEvent, PromptTracePhase } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";

export type PromptTraceEmitter = {
  emit(event: PromptTraceEvent): void;
};

const activeTraceIdBySession = new Map<string, string>();
const emittedFirstPhasesBySession = new Map<string, Set<PromptTracePhase>>();

export function createPromptTraceEmitter(input: {
  enabled: boolean;
  publish(event: PromptTraceEvent): void;
}): PromptTraceEmitter {
  if (!input.enabled) {
    return { emit() {} };
  }

  return {
    emit(event) {
      input.publish(event);
    },
  };
}

export function emitHelmPromptTrace(
  context: HelmHandlerContext,
  input: {
    traceId?: string;
    sessionId: string;
    phase: PromptTracePhase;
    meta?: Record<string, string | number | boolean | null>;
  },
) {
  const traceId = input.traceId ?? activeTraceIdBySession.get(input.sessionId) ?? input.sessionId;
  if (input.traceId) {
    activeTraceIdBySession.set(input.sessionId, input.traceId);
  }
  if (input.phase === "helm.prompt.send_start") {
    emittedFirstPhasesBySession.delete(input.sessionId);
  }
  context.promptTrace?.emit({
    traceId,
    sessionId: input.sessionId,
    phase: input.phase,
    timestamp: new Date().toISOString(),
    source: "helm",
    ...(input.meta ? { meta: input.meta } : {}),
  });
}

export function emitFirstHelmPromptTrace(
  context: HelmHandlerContext,
  input: {
    traceId?: string;
    sessionId: string;
    phase: PromptTracePhase;
    meta?: Record<string, string | number | boolean | null>;
  },
) {
  const emitted = emittedFirstPhasesBySession.get(input.sessionId) ?? new Set<PromptTracePhase>();
  if (emitted.has(input.phase)) {
    return;
  }
  emitted.add(input.phase);
  emittedFirstPhasesBySession.set(input.sessionId, emitted);
  emitHelmPromptTrace(context, input);
}
