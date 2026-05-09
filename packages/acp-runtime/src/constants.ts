export const DEFAULT_ACP_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_ACP_PROMPT_TIMEOUT_MS = 30 * 60_000;
export const OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS = 120_000;
export const ACP_INITIALIZE_TIMEOUT_MS = DEFAULT_ACP_REQUEST_TIMEOUT_MS;
export const ACP_EARLY_STDERR_FAILURE = /failed to start server|eaddrinuse|address already in use/i;

type AcpRequestTimeoutProvider = {
  id: string;
  command: string;
  initializeTimeoutMs?: number;
  promptTimeoutMs?: number;
  [key: string]: unknown;
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

  return isOpenCodeSessionRequest(provider, method)
    ? OPENCODE_ACP_SESSION_REQUEST_TIMEOUT_MS
    : DEFAULT_ACP_REQUEST_TIMEOUT_MS;
}

function isOpenCodeSessionRequest(provider: AcpRequestTimeoutProvider, method: string) {
  return (
    (method === "session/new" || method === "session/load" || method === "session/resume") &&
    (provider.id === "opencode" || commandName(provider.command) === "opencode")
  );
}

function commandName(command: string) {
  return command.split(/[\\/]/u).at(-1)?.replace(/\.exe$/iu, "").toLowerCase();
}
