import type { RuntimeConnectionSnapshot, RuntimeLifecycleEvent, SessionResumeInfo } from "@tiller/domain-contracts";

export type AgentRuntimePrompt = {
  sessionId: string;
  text: string;
  content?: unknown[];
  clientMessageId?: string;
};

export type AgentRuntimePromptResult = {
  accepted: boolean;
  runtimeSessionId?: string;
};

export type AgentRuntimePort = {
  prompt(input: AgentRuntimePrompt): Promise<AgentRuntimePromptResult>;
  cancel(sessionId: string): Promise<void>;
  reconnect(providerId: string, cwd: string): Promise<RuntimeConnectionSnapshot>;
  listConnections(): Promise<RuntimeConnectionSnapshot[]>;
  onLifecycle?(listener: (event: RuntimeLifecycleEvent) => void): () => void;
};

export type SessionResumePort = {
  resume(sessionId: string, restore: SessionResumeInfo): Promise<SessionResumeInfo>;
};
