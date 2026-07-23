import type {
  AcpRuntimeProviderConfig,
  AgentCapabilities,
  AgentPlan,
  AgentToolCall,
  SessionReasoningEffort,
} from "@tiller/shared";
import type { RuntimeEventOrigin, SessionRuntimeEvent } from "../runtime-types";
import type { ToolEvidence, ToolObservation } from "../tool-recognition";

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

export type ProviderCleanupPlan =
  | {
      kind: "remote-delete";
      command: string;
      args: string[];
      providerId: string;
      runtimeSessionId: string;
    }
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
  cwd?: string;
  updateType: string | undefined;
  update: unknown;
  text: string | null;
  now?: string;
};

export type AcpToolEvidenceContext = {
  observation: ToolObservation;
};

export type AcpPromptObservationContext = {
  runtimeSessionId: string;
  cwd: string;
  observeCompaction?: boolean;
};

export type AcpCompactionSummaryContext = {
  runtimeSessionId: string;
  cwd: string;
  completedAt?: string;
};

export type AcpCompactionSummary = {
  summaryText: string;
  summaryMessageId?: string;
};

export type AcpCompactionDetailsVisibility = "hidden";

export const SUPPRESS_SESSION_UPDATE = {
  kind: "suppress-session-update",
} as const;

export type AcpSessionUpdateProjection =
  | SessionRuntimeEvent
  | typeof SUPPRESS_SESSION_UPDATE;
export type AcpCompactionSignalSummary = { kind: string } & Record<
  string,
  unknown
>;

export type ProviderAdapterPluginManifest = {
  kind: "provider-adapter-plugin-placeholder";
  enabled: false;
  adapters: [];
};

export type AcpAgentAdapter = {
  id: string;
  isMatch(provider: AcpRuntimeProviderConfig): boolean;
  resolveLaunch(
    provider: AcpRuntimeProviderConfig,
    context: AcpLaunchContext,
  ): AcpLaunchSpec;
  resolveCapabilities(
    provider: AcpRuntimeProviderConfig,
    initializeResult: unknown,
    detected: AgentCapabilities,
  ): AgentCapabilities;
  resolveCleanup(context: AcpCleanupContext): ProviderCleanupPlan;
  resolveRequestTimeout?(context: AcpRequestTimeoutContext): number | undefined;
  mapMessageUpdate?(
    context: AcpSessionUpdateProjectionContext,
  ): AcpSessionUpdateProjection | null;
  mapToolCallUpdate?(
    context: AcpSessionUpdateProjectionContext,
  ): AcpSessionUpdateProjection | null;
  mapUnknownUpdate?(
    context: AcpSessionUpdateProjectionContext,
  ): AcpSessionUpdateProjection | null;
  resolveRuntimeEventOrigin?(
    context: AcpSessionUpdateProjectionContext,
  ): RuntimeEventOrigin | undefined;
  beginPromptObservation?(context: AcpPromptObservationContext): void;
  pollPromptToolObservations?(
    context: AcpPromptObservationContext,
  ): ToolObservation[];
  pollPromptRuntimeEvents?(
    context: AcpPromptObservationContext,
  ): SessionRuntimeEvent[];
  disposeSession?(sessionId: string): void;
  expandRuntimeEvent?(event: SessionRuntimeEvent): SessionRuntimeEvent[] | null;
  collectToolEvidence?(context: AcpToolEvidenceContext): ToolEvidence[];
  summarizeCompactionSignal?(text: string): AcpCompactionSignalSummary | null;
  resolveCompactionSummary?(
    context: AcpCompactionSummaryContext,
  ): string | AcpCompactionSummary | undefined;
  resolveCompactionDetailsVisibility?():
    | AcpCompactionDetailsVisibility
    | undefined;
  extractPlanFromToolCall?(toolCall: AgentToolCall): AgentPlan | null;
  isPlanToolCall?(toolCall: AgentToolCall): boolean;
};
