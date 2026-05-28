import { resolveProviderById } from "@tiller/agent-registry";
import type { AcpAgentProvider, SessionReasoningEffort, SessionResumeInfo, SessionSummary } from "@tiller/shared";
import type { StoredSessionRuntimeDescriptor } from "../sessions/facade";
import {
  alignSessionProjectBinding,
  alignSessionWorktreeBinding,
} from "../sessions/facade";
import {
  resolveConfigOptionsForSelection,
  resolveConfigReasoningEffortForOptions,
} from "./session-config-options";
import { buildSessionResumeInfo, resolveSessionRestoreCapabilities } from "./resume-info";

type SessionRecord = {
  runtime: {
    runtimeSessionId: string;
    sessionCapabilities?: StoredSessionRuntimeDescriptor["capabilities"];
    sessionConfigOptions?: SessionSummary["configOptions"];
    sessionConfigState?: {
      model?: string;
      reasoningEffort?: SessionReasoningEffort;
    };
  };
};

type SessionSummaryHydrationOptions = {
  sessions: Map<string, SessionRecord>;
  getProjects(): Parameters<typeof alignSessionProjectBinding>[1];
  getWorktrees(): Parameters<typeof alignSessionWorktreeBinding>[1];
  getAgents(): AcpAgentProvider[];
  sessionRuntimeStore: { get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined };
};

export function createSessionSummaryHydrationService(options: SessionSummaryHydrationOptions) {
  function buildResumeInfoFor(summary: SessionSummary, agent: AcpAgentProvider | undefined): SessionResumeInfo {
    return buildSessionResumeInfo(
      summary,
      agent,
      options.sessions.get(summary.id) as any,
      options.sessionRuntimeStore.get(summary.id),
    );
  }

  function hydrateSessionSummary(summary: SessionSummary): SessionSummary {
    const aligned = alignSessionWorktreeBinding(
      alignSessionProjectBinding(summary, options.getProjects()),
      options.getWorktrees(),
    );
    const record = options.sessions.get(summary.id);
    const agent = resolveProviderById(aligned.agentId, options.getAgents());
    const descriptor = options.sessionRuntimeStore.get(summary.id);
    const capabilities = resolveSessionRestoreCapabilities(
      agent,
      descriptor,
      record?.runtime.sessionCapabilities,
    );
    const hydratedModel = aligned.model ?? record?.runtime.sessionConfigState?.model;
    const resolvedHydratedConfigOptions = resolveConfigOptionsForSelection({
      incomingOptions: record?.runtime.sessionConfigOptions,
      previousOptions: aligned.configOptions,
      selectedModel: hydratedModel,
    });
    const hydratedConfigOptions = resolvedHydratedConfigOptions.options;
    const hydratedReasoningEffort = resolveConfigReasoningEffortForOptions(
      aligned.reasoningEffort ?? record?.runtime.sessionConfigState?.reasoningEffort,
      resolvedHydratedConfigOptions,
    );
    return {
      ...aligned,
      model: hydratedModel,
      reasoningEffort: hydratedReasoningEffort,
      configOptions: hydratedConfigOptions,
      imageInput: capabilities.imageInput,
      resume: buildResumeInfoFor(aligned, agent),
    };
  }

  function migrateStoredSessionSummary(summary: SessionSummary) {
    return hydrateSessionSummary(summary);
  }

  return {
    buildResumeInfo: buildResumeInfoFor,
    hydrateSessionSummary,
    migrateStoredSessionSummary,
  };
}
