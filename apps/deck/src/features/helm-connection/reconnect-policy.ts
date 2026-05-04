export type AppView = "overview" | "sessions" | "agents" | "settings";

export function shouldEnsureLiveConnection(view: AppView) {
  return view === "sessions" || view === "agents";
}

export function shouldAttemptSilentReconnect(input: {
  connection: "connecting" | "connected" | "disconnected";
  tokenPresent: boolean;
  embedded?: boolean;
  host: string;
  port: string;
}) {
  return input.connection === "disconnected"
    && Boolean(input.host.trim())
    && Boolean(input.port.trim());
}
