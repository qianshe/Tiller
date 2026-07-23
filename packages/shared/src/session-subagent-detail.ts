import type { SessionTimelineBatch, SessionTimelineEntry } from "./session-timeline";

export type SessionSubagentDetail = {
  sessionId: string;
  parentToolCallId: string;
  throughSequence: number;
  entries: SessionTimelineEntry[];
};

export type SessionSubagentDetailDelta = {
  sessionId: string;
  parentToolCallId: string;
  batch: SessionTimelineBatch;
};
