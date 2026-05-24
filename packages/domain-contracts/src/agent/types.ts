export type AgentTransport = "stdio";

export type AcpProviderKind = "native-acp" | "adapter-acp" | "custom";

export type SessionConfigSupport = {
  model: "none" | "startup" | "runtime";
  reasoningEffort: "none" | "startup" | "runtime";
  modelFormat?: "model" | "provider/model";
};

export type AgentCapabilities = {
  streaming?: boolean;
  permissionRequests?: boolean;
  fileDiffs?: boolean;
  commandOutput?: boolean;
  sessionConfig?: Partial<SessionConfigSupport>;
  sessionLoad?: boolean;
  sessionResume?: boolean;
  sessionList?: boolean;
  sessionClose?: boolean;
  sessionDelete?: boolean;
  cancellation?: boolean;
  imageInput?: boolean;
};

export type AcpMcpServer = {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type AgentProviderDescriptor = {
  id: string;
  name: string;
  description?: string;
  kind?: AcpProviderKind;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  mcpServers?: AcpMcpServer[];
  cwd?: string;
  initializeTimeoutMs?: number;
  promptTimeoutMs?: number;
  defaultAgent?: string;
  transport: AgentTransport;
  protocol: "acp";
  installHint?: string;
  capabilities?: Partial<AgentCapabilities>;
};
