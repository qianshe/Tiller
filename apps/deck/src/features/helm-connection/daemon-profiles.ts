export const DAEMON_PROFILE_STORAGE_KEY = "tiller.daemon-profiles";

export type DaemonProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
};

export function daemonProfileKey(host: string, port: string) {
  return `${host}:${port}`;
}

export function formatDaemonProfileLine(
  profile: DaemonProfile,
  currentHost: string,
  currentPort: string,
  connection: "connecting" | "connected" | "disconnected",
) {
  const isCurrent = profile.host === currentHost && profile.port === currentPort;
  const status = isCurrent ? formatConnectionStatus(connection) : "已保存";
  return `${profile.name} · ${profile.host}:${profile.port} · ${status}`;
}

export function formatConnectionStatus(connection: "connecting" | "connected" | "disconnected") {
  return connection === "connected" ? "已连接" : connection === "connecting" ? "连接中" : "已断开";
}

export function formatPairingState(state: "idle" | "waiting" | "input" | "paired" | "rejected") {
  const labels = {
    idle: "未开始",
    waiting: "等待中",
    input: "等待输入",
    paired: "已配对",
    rejected: "已拒绝",
  } as const;
  return labels[state];
}

export function readDaemonProfiles(): DaemonProfile[] {
  try {
    const raw = window.localStorage.getItem(DAEMON_PROFILE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is DaemonProfile => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Record<string, unknown>;
      return (
        typeof candidate.id === "string" &&
        typeof candidate.name === "string" &&
        typeof candidate.host === "string" &&
        typeof candidate.port === "string"
      );
    });
  } catch {
    return [];
  }
}