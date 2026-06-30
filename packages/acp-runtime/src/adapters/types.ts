import type {
  AcpRuntimeProviderConfig,
  AgentCapabilities,
  AgentMessage,
  AgentPlan,
  AgentToolCall,
  SessionReasoningEffort,
} from "@tiller/shared";
import type { SessionRuntimeEvent } from "../runtime-types";

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
  plan?: AgentPlan;
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

export type AcpSessionUpdateProjectionContext = {
  sessionId: string;
  updateType: string | undefined;
  update: unknown;
  now?: string;
};

export type AcpToolCallNormalizationContext = {
  toolCall: AgentToolCall;
  update: unknown;
};

export type AcpCompactionDetailsVisibility = "hidden";

export const SUPPRESS_SESSION_UPDATE = { kind: "suppress-session-update" } as const;

export type AcpSessionUpdateProjection = SessionRuntimeEvent | typeof SUPPRESS_SESSION_UPDATE;

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
  mapSessionUpdate?(context: AcpSessionUpdateProjectionContext): AcpSessionUpdateProjection | null;
  normalizeToolCall?(context: AcpToolCallNormalizationContext): AgentToolCall;
  resolveCompactionDetailsVisibility?(): AcpCompactionDetailsVisibility | undefined;
  readTranscriptPlan?(context: AcpHistoryContext): AgentPlan | null;
  readTranscriptMessages?(context: AcpHistoryContext): AgentMessage[];
};
