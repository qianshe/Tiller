import type { AppView } from "../../shared/utils/routes";

export type { AppView };

export function shouldEnsureLiveConnection(view: AppView) {
  return view === "sessions" || view === "agents" || view === "settings";
}

export function shouldCheckHelmHealth(view: AppView) {
  // 在这些页面应该检测 Helm 健康状态，即使不建立完整连接
  return view === "overview" || view === "dashboard";
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
