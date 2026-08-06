import { resolveProviderById } from "@tiller/agent-registry";
import type { AcpAgentProvider, SessionSummary } from "@tiller/shared";
import type { StoredSessionRuntimeDescriptor } from "../sessions/facade";
import { resolveSessionRestoreCapabilities } from "./resume-info";

type RuntimeDescriptorStore = {
  get(sessionId: string): StoredSessionRuntimeDescriptor | null | undefined;
  upsert(descriptor: StoredSessionRuntimeDescriptor): void;
};

type RuntimeDescriptorServiceOptions = {
  sessionRuntimeStore: RuntimeDescriptorStore;
  getAgents(): AcpAgentProvider[];
};

type PendingConfig = NonNullable<StoredSessionRuntimeDescriptor["pendingConfig"]>;

function mergePendingConfig(
  existing: PendingConfig | undefined,
  next: PendingConfig,
): PendingConfig {
  const nextConfigIds = new Set(
    next.configOptions?.map((option) => option.configId) ?? [],
  );
  const configOptions = [
    ...(existing?.configOptions ?? []).filter(
      (option) => !nextConfigIds.has(option.configId),
    ),
    ...(next.configOptions ?? []),
  ];
  return {
    ...existing,
    ...next,
    ...(configOptions.length ? { configOptions } : {}),
  };
}

export function createRuntimeDescriptorService(options: RuntimeDescriptorServiceOptions) {
  function persistRuntimeDescriptor(
    summary: SessionSummary,
    agent: AcpAgentProvider | undefined,
    capabilities?: StoredSessionRuntimeDescriptor["capabilities"],
    pendingConfig?: StoredSessionRuntimeDescriptor["pendingConfig"] | null,
  ) {
    const existingDescriptor = options.sessionRuntimeStore.get(summary.id);
    const resolvedCapabilities = resolveSessionRestoreCapabilities(
      agent,
      existingDescriptor,
      capabilities,
    );
    if (
      !summary.runtimeSessionId &&
      !resolvedCapabilities.sessionLoad &&
      !resolvedCapabilities.sessionResume &&
      !resolvedCapabilities.sessionList &&
      !resolvedCapabilities.sessionClose &&
      !resolvedCapabilities.sessionDelete &&
      !resolvedCapabilities.imageInput
    ) {
      return;
    }

    const resolvedPendingConfig = pendingConfig === undefined
      ? existingDescriptor?.pendingConfig
      : pendingConfig === null
        ? undefined
        : mergePendingConfig(existingDescriptor?.pendingConfig, pendingConfig);
    options.sessionRuntimeStore.upsert({
      sessionId: summary.id,
      projectId: summary.projectId,
      helmId: summary.helmId,
      providerId: summary.agentId,
      runtimeSessionId: summary.runtimeSessionId,
      capabilities: resolvedCapabilities,
      ...(resolvedPendingConfig ? { pendingConfig: resolvedPendingConfig } : {}),
      lastSeenAt: summary.updatedAt,
      state: summary.status === "error" || summary.status === "cancelled" ? "stale" : "resumeable",
    });
  }

  function resolveAgent(summary: SessionSummary) {
    return resolveProviderById(summary.agentId, options.getAgents());
  }

  return {
    persistRuntimeDescriptor,
    resolveAgent,
  };
}
