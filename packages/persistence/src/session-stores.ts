import type {
  AgentMessage,
  AgentPlan,
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
import type { SessionDiffBodyStore } from "./diff-body-store";
import type { SessionMessagePage, SessionMessagePageOptions } from "./message-store";
import type { SessionOutputBodyStore } from "./output-body-store";
import type { SessionStateStore } from "./session-state-store";
import type { SessionApprovalStore } from "./session-approval-store";
import type { StoredSessionRuntimeDescriptor } from "./runtime-store";
import type { SessionTimelinePage, SessionTimelinePageOptions } from "./timeline-store";
import type { SessionLegacyEvidenceStore } from "./legacy-evidence-store";

export type StoredSessionArtifacts = {
  outputs: CommandChunk[];
  diffs: FileDiffSummary[];
  toolCalls: AgentToolCall[];
};

export type SessionSummaryStore = {
  get: (sessionId: string) => SessionSummary | undefined;
  list: () => SessionSummary[];
  upsert: (summary: SessionSummary) => void;
  remove: (sessionId: string) => void;
};

export type SessionMessageStore = {
  append: (sessionId: string, message: AgentMessage) => AgentMessage[];
  replace: (sessionId: string, messages: AgentMessage[]) => AgentMessage[];
  list: (sessionId: string) => AgentMessage[];
  listPage: (sessionId: string, options?: SessionMessagePageOptions) => SessionMessagePage;
  remove: (sessionId: string) => void;
};

export type SessionArtifactStore = {
  appendOutput: (sessionId: string, chunk: CommandChunk) => void;
  replaceOutputs: (sessionId: string, outputs: CommandChunk[]) => void;
  replaceDiffs: (sessionId: string, diffs: FileDiffSummary[]) => void;
  appendToolCall: (sessionId: string, toolCall: AgentToolCall) => void;
  replaceToolCalls: (sessionId: string, toolCalls: AgentToolCall[]) => void;
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

export type SessionPlanStore = {
  get: (sessionId: string) => AgentPlan | undefined;
  replace: (sessionId: string, plan: AgentPlan) => AgentPlan;
  remove: (sessionId: string) => void;
};

export type SessionTimelineStore = {
  upsertMessage?: (sessionId: string, message: AgentMessage) => SessionTimelineEntry | undefined;
  upsertToolCall?: (sessionId: string, toolCall: AgentToolCall) => SessionTimelineEntry | undefined;
  replace: (sessionId: string, entries: SessionTimelineEntry[]) => SessionTimelineEntry[];
  list: (sessionId: string) => SessionTimelineEntry[];
  listPage: (sessionId: string, options?: SessionTimelinePageOptions) => SessionTimelinePage;
  applyBatch: (sessionId: string, batch: SessionTimelineBatch) => SessionTimelineEntry[];
  commitBatch?: (
    sessionId: string,
    batch: SessionTimelineBatch,
    updates: SessionUpdateRecord[],
  ) => SessionTimelineEntry[];
  remove: (sessionId: string) => void;
};

export type SessionUpdateStore = {
  append: (update: SessionUpdateRecord) => void;
  getMaxSequence: (sessionId: string) => number;
  compactTail: (sessionId: string, retain?: number) => number;
  listPage: (sessionId: string, options?: { limit?: number; before?: string }) => SessionUpdateRecordPage;
  remove: (sessionId: string) => void;
};

export type SessionStores = {
  sessionStore: SessionSummaryStore;
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionLegacyEvidenceStore: SessionLegacyEvidenceStore;
  sessionAttachmentStore: SessionAttachmentStore;
  sessionDiffBodyStore: SessionDiffBodyStore;
  sessionOutputBodyStore: SessionOutputBodyStore;
  sessionRuntimeStore: SessionRuntimeStore;
  sessionPlanStore: SessionPlanStore;
  sessionTimelineStore: SessionTimelineStore;
  sessionUpdateStore: SessionUpdateStore;
  sessionStateStore: SessionStateStore;
  sessionApprovalStore: SessionApprovalStore;
};

export type HelmSessionStores = SessionStores;
