import type { TillerLogger } from "./logger";

export type RuntimeMetricFields = {
  sessionId?: string;
  providerId?: string;
  sequence?: number;
  eventType?: string;
  entityKind?: string;
  payloadBytes?: number;
  queueDepth?: number;
  batchSize?: number;
  reducerMs?: number;
  persistMs?: number;
  publishMs?: number;
  replayRecords?: number;
  wsBufferedBytes?: number;
  coalescedDeltaCount?: number;
};

export type RuntimeMetrics = {
  observe(sessionId: string, fields: RuntimeMetricFields): void;
  flush(): RuntimeMetricFields[];
  removeSession(sessionId: string): void;
  dispose(): void;
};

const NUMERIC_FIELDS = [
  "payloadBytes",
  "queueDepth",
  "batchSize",
  "reducerMs",
  "persistMs",
  "publishMs",
  "replayRecords",
  "wsBufferedBytes",
  "coalescedDeltaCount",
] as const;

export function createRuntimeMetrics(options: {
  logger: Pick<TillerLogger, "info">;
  flushIntervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): RuntimeMetrics {
  const aggregates = new Map<string, RuntimeMetricFields>();
  const flushIntervalMs = options.flushIntervalMs ?? 30_000;

  const metrics: RuntimeMetrics = {
    observe(sessionId, fields) {
      const current = aggregates.get(sessionId) ?? { sessionId };
      const next: RuntimeMetricFields = {
        ...current,
        sessionId,
        providerId: boundedLabel(fields.providerId ?? current.providerId),
        eventType: boundedLabel(fields.eventType ?? current.eventType),
        entityKind: boundedLabel(fields.entityKind ?? current.entityKind),
        sequence: fields.sequence ?? current.sequence,
      };
      for (const key of NUMERIC_FIELDS) {
        const value = fields[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          next[key] = (current[key] ?? 0) + value;
        }
      }
      aggregates.set(sessionId, next);
    },
    flush() {
      const records = [...aggregates.values()];
      aggregates.clear();
      return records;
    },
    removeSession(sessionId) {
      aggregates.delete(sessionId);
    },
    dispose() {
      clearIntervalFn(timer);
      publishMetrics(metrics.flush(), options.logger);
    },
  };
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const timer = setIntervalFn(() => {
    publishMetrics(metrics.flush(), options.logger);
  }, flushIntervalMs);
  timer.unref?.();
  return metrics;
}

function publishMetrics(
  records: RuntimeMetricFields[],
  logger: Pick<TillerLogger, "info">,
) {
  for (const record of records) {
    logger.info("runtime.metrics", record);
  }
}

function boundedLabel(value: string | undefined) {
  return value?.slice(0, 64);
}
