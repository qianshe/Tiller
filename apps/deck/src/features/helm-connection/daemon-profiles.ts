export const DAEMON_PROFILE_STORAGE_KEY = "tiller.daemon-profiles";

export type DaemonProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
};

function normalizeDaemonHost(host: string) {
  const normalizedHost = host.trim().toLowerCase();
  return normalizedHost === "localhost" ? "127.0.0.1" : normalizedHost;
}

export function daemonProfileKey(host: string, port: string) {
  return `${normalizeDaemonHost(host)}:${port.trim()}`;
}

export function mergeDaemonProfile(
  profiles: DaemonProfile[],
  profile: DaemonProfile,
) {
  const profileKey = daemonProfileKey(profile.host, profile.port);
  return [
    ...profiles.filter(
      (item) => daemonProfileKey(item.host, item.port) !== profileKey,
    ),
    profile,
  ];
}

export function formatDaemonProfileLine(
  profile: DaemonProfile,
  currentHost: string,
  currentPort: string,
  connection: "connecting" | "connected" | "disconnected",
) {
  const isCurrent =
    daemonProfileKey(profile.host, profile.port) ===
    daemonProfileKey(currentHost, currentPort);
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
