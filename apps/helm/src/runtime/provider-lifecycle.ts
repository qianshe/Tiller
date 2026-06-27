import {
  createAcpRuntime,
  type AcpProtocolLoggingOptions,
  type AcpConnectionLifecycleEvent,
  type SessionRuntimeEvent,
} from "@tiller/acp-runtime";
import type { AcpAgentProvider, WorktreeSummary } from "@tiller/shared";
import { cleanupDraftProviderRuntime } from "../providers/draft-cleanup";

type CreateRuntimeInput = {
  sessionId: string;
  worktree: WorktreeSummary;
  agent: AcpAgentProvider;
  sessionConfig?: {
    agentMode?: string;
    model?: string;
    reasoningEffort?: unknown;
  };
  restore?: {
    runtimeSessionId: string;
    strategy: "load" | "resume";
    replayBaselineMessages?: unknown[];
  };
  onEvent: (event: SessionRuntimeEvent) => void;
  onRestoreReplayEvent?: (event: SessionRuntimeEvent) => void;
  onConnectionLifecycleEvent?: (event: AcpConnectionLifecycleEvent) => void;
  protocolLogging?: AcpProtocolLoggingOptions;
};

export type HelmRuntimeHandle = Awaited<ReturnType<typeof createAcpRuntime>>;

// Owns the ACP runtime adapter boundary: creating/reusing provider runtimes and
// delegating provider-specific draft cleanup behind a small testable port.
export type ProviderLifecyclePort = {
  createRuntime(input: CreateRuntimeInput): Promise<HelmRuntimeHandle>;
  cleanupDraftRuntime(runtime: HelmRuntimeHandle, agent: AcpAgentProvider): ReturnType<typeof cleanupDraftProviderRuntime>;
};

export type ProviderLifecycleDependencies = {
  createRuntime?: typeof createAcpRuntime;
  cleanupDraftRuntime?: typeof cleanupDraftProviderRuntime;
};

export function createProviderLifecycle(
  dependencies: ProviderLifecycleDependencies = {},
): ProviderLifecyclePort {
  const createRuntime = dependencies.createRuntime ?? createAcpRuntime;
  const cleanupDraftRuntime = dependencies.cleanupDraftRuntime ?? cleanupDraftProviderRuntime;
  return {
    createRuntime(input) {
      return createRuntime(input as Parameters<typeof createAcpRuntime>[0]);
    },
    cleanupDraftRuntime(runtime, agent) {
      return cleanupDraftRuntime(runtime, agent);
    },
  };
}
