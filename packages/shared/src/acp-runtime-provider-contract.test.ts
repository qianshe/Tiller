import type { AcpAgentProvider, AcpRuntimeProviderConfig } from "./types";

const runtimeProvider = {
  id: "codex",
  name: "Codex ACP",
  kind: "native-acp",
  command: "codex-acp",
  args: ["--stdio"],
  cwd: "D:/repo",
  initializeTimeoutMs: 30_000,
  promptTimeoutMs: 120_000,
  defaultAgent: "coder",
  transport: "stdio",
  protocol: "acp",
  capabilities: {
    streaming: true,
    sessionLoad: true,
  },
} satisfies AcpRuntimeProviderConfig;

const legacyProvider: AcpAgentProvider = runtimeProvider;

void legacyProvider;
