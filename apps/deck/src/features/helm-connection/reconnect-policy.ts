import type { AppView } from "../../shared/utils/routes";

export type { AppView };

export function shouldEnsureLiveConnection(view: AppView) {
  return view === "sessions" || view === "agents" || view === "settings";
}

export function shouldCheckHelmHealth(view: AppView) {
  // 这些页面展示健康状态，但健康状态复用主连接，不额外建立探测连接。
  return view === "overview" || view === "dashboard";
}

export function resolveHelmHealthStatus(input: {
  connection: "connecting" | "connected" | "disconnected";
  host: string;
  port: string;
}): "unknown" | "healthy" | "unhealthy" {
  if (!input.host.trim() || !input.port.trim() || input.connection === "connecting") {
    return "unknown";
  }
  return input.connection === "connected" ? "healthy" : "unhealthy";
}

export function shouldAttemptSilentReconnect(input: {
  connection: "connecting" | "connected" | "disconnected";
  tokenPresent: boolean;
  embedded?: boolean;
  host: string;
  port: string;
}) {
  return (
    input.connection === "disconnected" &&
    Boolean(input.host.trim()) &&
    Boolean(input.port.trim())
  );
}

export function shouldRunSilentReconnect(input: {
  missionVisualMode: boolean;
  connection: "connecting" | "connected" | "disconnected";
  tokenPresent: boolean;
  embedded?: boolean;
  host: string;
  port: string;
}): boolean {
  if (input.missionVisualMode) {
    return false;
  }
  return shouldAttemptSilentReconnect(input);
}
