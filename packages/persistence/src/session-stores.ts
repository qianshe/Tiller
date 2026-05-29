import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionSummary,
} from "@tiller/shared";
import type { SessionArtifactPage, SessionArtifactPageOptions } from "./artifact-store";
import type { SessionMessagePage, SessionMessagePageOptions } from "./message-store";
import type { StoredSessionRuntimeDescriptor } from "./runtime-store";

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

export type SessionStores = {
  sessionStore: SessionSummaryStore;
  sessionMessageStore: SessionMessageStore;
  sessionArtifactStore: SessionArtifactStore;
  sessionRuntimeStore: SessionRuntimeStore;
};

export type HelmSessionStores = SessionStores;
