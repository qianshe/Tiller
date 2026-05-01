import type { AcpAgentProvider, AgentCapabilities, AgentMessage, AgentToolCall, SessionReasoningEffort } from "@tiller/shared";

export type AcpLaunchContext = {
  fallbackCwd: string;
  sessionConfig?: {
    model?: string;
    reasoningEffort?: SessionReasoningEffort;
  };
};

export type AcpLaunchSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type AcpAuthoritativeHistory = {
  messages: AgentMessage[];
  toolCalls: AgentToolCall[];
};

export type AcpHistoryContext = {
  provider: AcpAgentProvider;
  runtimeSessionId: string;
  cwd: string;
};

export type ProviderCleanupPlan =
  | { kind: "remote-delete"; command: string; args: string[]; providerId: string; runtimeSessionId: string }
  | { kind: "unsupported"; providerId: string; message: string };

export type AcpCleanupContext = {
  provider: AcpAgentProvider;
  runtimeSessionId: string;
};

export type AcpAgentAdapter = {
  id: string;
  isMatch(provider: AcpAgentProvider): boolean;
  resolveLaunch(provider: AcpAgentProvider, context: AcpLaunchContext): AcpLaunchSpec;
  resolveCapabilities(provider: AcpAgentProvider, initializeResult: unknown, detected: AgentCapabilities): AgentCapabilities;
  resolveCleanup(context: AcpCleanupContext): ProviderCleanupPlan;
};
