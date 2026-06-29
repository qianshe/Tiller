import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionUpdateRecord,
  SessionUpdateRecordPage,
  SessionSummary,
} from "@tiller/shared";
import type { SessionArtifactPage, SessionArtifactPageOptions } from "./artifact-store";
import type { SessionAttachmentStore } from "./attachment-store";
import type { SessionMessagePage, SessionMessagePageOptions } from "./message-store";
import type { StoredSessionRuntimeDescriptor } from "./runtime-store";
import type { SessionTimelinePage, SessionTimelinePageOptions } from "./timeline-store";

export type StoredSessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export type SessionSummaryStore = {
  list: () => SessionSummary[];
  upsert: (summary: SessionSummary) => SessionSummary[];
  remove: (sessionId: string) => SessionSummary[];
};

export type SessionMessageStore = {
  append: (sessionId: string, message: AgentMessage) => AgentMessage[];
  replace: (sessionId: string, messages: AgentMessage[]) => AgentMessage[];
  list: (sessionId: string) => AgentMessage[];
  listPage: (sessionId: string, options?: SessionMessagePageOptions) => SessionMessagePage;
  remove: (sessionId: string) => void;
};

export type SessionArtifactStore = {
  appendOutput: (sessionId: string, chunk: CommandChunk) => StoredSessionArtifacts;
  replaceOutputs: (sessionId: string, outputs: CommandChunk[]) => StoredSessionArtifacts;
  replaceDiffs: (sessionId: string, diffs: FileDiffSummary[]) => StoredSessionArtifacts;
  appendToolCall: (sessionId: string, toolCall: AgentToolCall) => StoredSessionArtifacts;
  replaceToolCalls: (sessionId: string, toolCalls: AgentToolCall[]) => StoredSessionArtifacts;
  get: (sessionId: string) => StoredSessionArtifacts;
  getPage: (sessionId: string, options?: SessionArtifactPageOptions) => SessionArtifactPage;
  remove: (sessionId: string) => void;
};

export type SessionRuntimeStore = {
  list: () => StoredSessionRuntimeDescriptor[];
  get: (sessionId: string) => StoredSessionRuntimeDescriptor | null;
  upsert: (descriptor: StoredSessionRuntimeDescriptor) => StoredSessionRuntimeDescriptor;
  remove: (sessionId: string) => void;
};

export type SessionTimelineStore = {
  append: (sessionId: string, entry: SessionTimelineEntry) => SessionTimelineEntry[];
  upsertMessage?: (sessionId: string, message: AgentMessage) => SessionTimelineEntry | undefined;
  upsertToolCall?: (sessionId: string, toolCall: AgentToolCall) => SessionTimelineEntry | undefined;
  replace: (sessionId: string, entries: SessionTimelineEntry[]) => SessionTimelineEntry[];
  list: (sessionId: string) => SessionTimelineEntry[];
  listPage: (sessionId: string, options?: SessionTimelinePageOptions) => SessionTimelinePage;
  applyBatch: (sessionId: string, batch: SessionTimelineBatch) => SessionTimelineEntry[];
  remove: (sessionId: string) => void;
};

export type SessionUpdateStore = {
  append: (update: SessionUpdateRecord) => void;
  replaceSession: (sessionId: string, updates: SessionUpdateRecord[]) => void;
  listPage: (sessionId: string, options?: { limit?: number; before?: string }) => SessionUpdateRecordPage;
  remove: (sessionId: string) => void;
};

export type SessionStores = {
  sessionStore: SessionSummaryStore;
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionAttachmentStore: SessionAttachmentStore;
  sessionRuntimeStore: SessionRuntimeStore;
  sessionTimelineStore: SessionTimelineStore;
  sessionUpdateStore: SessionUpdateStore;
};

export type HelmSessionStores = SessionStores;
