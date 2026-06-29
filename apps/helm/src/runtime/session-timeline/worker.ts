import type { SessionRuntimeEvent } from "@tiller/acp-runtime";
import type { SessionTimelineBatch } from "@tiller/shared";
import {
  applySessionRuntimeEvent,
  buildSessionTimelineBatch,
  createEmptySessionTimelineAggregate,
  type SessionTimelineAggregate,
} from "./aggregate";

export type SessionTimelineWorker = {
  sessionId: string;
  enqueue(event: SessionRuntimeEvent): void;
  flush(): SessionTimelineBatch[];
  aggregate(): SessionTimelineAggregate;
};

export type SessionTimelineWorkerOptions = {
  sessionId: string;
  providerId?: string;
  lastSequence?: number;
};

export function createSessionTimelineWorker(
  options: SessionTimelineWorkerOptions,
): SessionTimelineWorker {
  let aggregate = createEmptySessionTimelineAggregate(options.sessionId, {
    providerId: options.providerId,
    lastSequence: options.lastSequence,
  });
  let lastFlushed = aggregate;

  return {
    sessionId: options.sessionId,

    enqueue(event: SessionRuntimeEvent) {
      aggregate = applySessionRuntimeEvent(aggregate, event);
    },

    flush(): SessionTimelineBatch[] {
      const batch = buildSessionTimelineBatch(lastFlushed, aggregate);
      lastFlushed = aggregate;
      return batch ? [batch] : [];
    },

    aggregate() {
      return aggregate;
    },
  };
}
