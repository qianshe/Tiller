export type SessionUpdateSource =
  | "acp_live"
  | "acp_load_replay"
  | "local_history_repair"
  | "agent_transcript_repair";

export type SessionUpdateRecord = {
  sessionId: string;
  runtimeSessionId: string;
  providerId: string;
  sequence: number;
  source: SessionUpdateSource;
  updateType: string;
  receivedAt: string;
  payloadJson: string;
};

export type SessionUpdateRecordPage = {
  updates: SessionUpdateRecord[];
  nextCursor?: string;
  hasMore: boolean;
};
