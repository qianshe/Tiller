import { resolveAdapterRequestTimeout } from "./adapters";
import type { AcpAgentProvider } from "@tiller/shared";

export const DEFAULT_ACP_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_ACP_PROMPT_TIMEOUT_MS = 30 * 60_000;
export const DEFAULT_ACP_PROMPT_START_TIMEOUT_MS = 45_000;
export const ACP_INITIALIZE_TIMEOUT_MS = DEFAULT_ACP_REQUEST_TIMEOUT_MS;
export const ACP_EARLY_STDERR_FAILURE = /failed to start server|eaddrinuse|address already in use/i;

type AcpRequestTimeoutProvider = AcpAgentProvider & {
  initializeTimeoutMs?: number;
  promptTimeoutMs?: number;
};

export function resolveAcpRequestTimeout(
  provider: AcpRequestTimeoutProvider,
  method: string,
) {
  if (method === "session/prompt") {
    return provider.promptTimeoutMs ?? DEFAULT_ACP_PROMPT_TIMEOUT_MS;
  }

  if (typeof provider.initializeTimeoutMs === "number") {
    return provider.initializeTimeoutMs;
  }

  return resolveAdapterRequestTimeout(provider, method) ?? DEFAULT_ACP_REQUEST_TIMEOUT_MS;
}
