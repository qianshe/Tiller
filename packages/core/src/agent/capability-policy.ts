import type { AgentCapabilities, AgentProviderDescriptor, SessionConfigSupport } from "@tiller/domain-contracts";

export const DEFAULT_AGENT_CAPABILITIES: Required<Pick<AgentCapabilities, "streaming" | "permissionRequests" | "fileDiffs" | "commandOutput" | "sessionLoad" | "sessionResume" | "sessionList" | "sessionClose" | "sessionDelete" | "cancellation" | "imageInput">> = {
  streaming: false,
  permissionRequests: false,
  fileDiffs: false,
  commandOutput: false,
  sessionLoad: false,
  sessionResume: false,
  sessionList: false,
  sessionClose: false,
  sessionDelete: false,
  cancellation: false,
  imageInput: false,
};

export function resolveAgentCapabilities(provider: AgentProviderDescriptor): AgentCapabilities {
  return {
    ...DEFAULT_AGENT_CAPABILITIES,
    ...provider.capabilities,
    sessionConfig: resolveSessionConfigSupport(provider),
  };
}

export function supportsProviderCapability(provider: AgentProviderDescriptor, capability: keyof AgentCapabilities): boolean {
  const capabilities = resolveAgentCapabilities(provider);
  const value = capabilities[capability];
  return typeof value === "boolean" ? value : Boolean(value);
}

export function resolveSessionConfigSupport(provider: AgentProviderDescriptor): Partial<SessionConfigSupport> {
  if (provider.capabilities?.sessionConfig) {
    return provider.capabilities.sessionConfig;
  }
  if (provider.command === "codex-acp") {
    return { model: "startup", reasoningEffort: "startup", modelFormat: "model" };
  }
  if (provider.command === "opencode") {
    return { model: "startup", reasoningEffort: "none", modelFormat: "provider/model" };
  }
  return { model: "none", reasoningEffort: "none" };
}
