import type { CanonicalSessionState, SessionUpdateRecord } from "@tiller/shared";

export type SessionStateStore = {
  get(sessionId: string): CanonicalSessionState | undefined;
  getAppliedSequence(sessionId: string): number;
  replace(sessionId: string, state: CanonicalSessionState): CanonicalSessionState;
  commitUpdate(update: SessionUpdateRecord, state: CanonicalSessionState): CanonicalSessionState;
  remove(sessionId: string): void;
  close(): void;
};
