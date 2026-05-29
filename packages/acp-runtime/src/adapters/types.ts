import type {
  AcpRuntimeProviderConfig,
  AgentCapabilities,
  AgentMessage,
  AgentToolCall,
  SessionReasoningEffort,
} from "@tiller/shared";

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
  provider: AcpRuntimeProviderConfig;
  runtimeSessionId: string;
  cwd: string;
};

export type ProviderCleanupPlan =
  | { kind: "remote-delete"; command: string; args: string[]; providerId: string; runtimeSessionId: string }
  | { kind: "unsupported"; providerId: string; message: string };

export type AcpCleanupContext = {
  provider: AcpRuntimeProviderConfig;
  runtimeSessionId: string;
};

export type AcpRequestTimeoutContext = {
  provider: AcpRuntimeProviderConfig;
  method: string;
};

export type ProviderAdapterPluginManifest = {
  kind: "provider-adapter-plugin-placeholder";
  enabled: false;
  adapters: [];
};

export type AcpAgentAdapter = {
  id: string;
  isMatch(provider: AcpRuntimeProviderConfig): boolean;
  resolveLaunch(provider: AcpRuntimeProviderConfig, context: AcpLaunchContext): AcpLaunchSpec;
  resolveCapabilities(
    provider: AcpRuntimeProviderConfig,
    initializeResult: unknown,
    detected: AgentCapabilities,
  ): AgentCapabilities;
  resolveCleanup(context: AcpCleanupContext): ProviderCleanupPlan;
  resolveRequestTimeout?(context: AcpRequestTimeoutContext): number | undefined;
  loadAuthoritativeHistory?(context: AcpHistoryContext): Promise<AcpAuthoritativeHistory | null>;
};
