import type { TrustedDeviceSummary } from "@tiller/shared";
import type { DeckLanguage } from "../../preferences";
import { formatDeviceTime } from "../../../shared/utils/format-time";

type TrustedDevicesPanelProps = {
  devices: TrustedDeviceSummary[];
  targetSocket: WebSocket | null;
  helmName: string;
  language: DeckLanguage;
  deckDeviceId: string;
  onRevokeDevice: (deviceId: string, targetSocket: WebSocket | null) => void;
};

type TrustedDeviceRow = TrustedDeviceSummary & {
  displayName: string;
  isCurrentDevice: boolean;
};

/**
 * Renders trusted Beacon devices for a Helm without owning socket or auth state.
 */
export function TrustedDevicesPanel({
  devices,
  targetSocket,
  helmName,
  language,
  deckDeviceId,
  onRevokeDevice,
}: TrustedDevicesPanelProps) {
  const labels = resolveTrustedDeviceLabels(language, devices.length, helmName);
  const deviceRows = resolveTrustedDeviceRows(devices, deckDeviceId);

  return (
    <section className="helm-beacon-section">
      <div className="helm-beacon-head">
        <h3>{labels.title}</h3>
        <span className="muted compact">{labels.count}</span>
      </div>
      {deviceRows.length ? (
        <ul className="helm-beacon-simple-list">
          {deviceRows.map((device) => (
            <li key={device.deviceId} className="helm-beacon-simple-row">
              <strong
                className="helm-beacon-device-name"
                title={device.displayName}
              >
                {device.displayName}
              </strong>
              <span className="status-chip subtle-chip helm-beacon-kind">
                {device.clientKind === "app" ? labels.app : labels.web}
              </span>
              {device.isCurrentDevice ? (
                <span className="status-chip helm-beacon-current">
                  {labels.current}
                </span>
              ) : null}
              <span className="helm-beacon-meta helm-beacon-last">
                {labels.lastSeen} · {formatDeviceTime(device.lastSeenAt)}
              </span>
              <span className="helm-beacon-meta helm-beacon-expires">
                {labels.expiresAt} · {formatDeviceTime(device.expiresAt)}
              </span>
              <button
                aria-label={labels.revokeDevice(device.displayName)}
                className="secondary helm-beacon-action"
                type="button"
                onClick={() => onRevokeDevice(device.deviceId, targetSocket)}
              >
                {labels.revoke}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state helm-beacon-empty">{labels.empty}</div>
      )}
    </section>
  );
}

function resolveTrustedDeviceLabels(
  language: DeckLanguage,
  count: number,
  helmName: string,
) {
  return language === "en-US"
    ? {
        title: "Beacons",
        count: `${count}`,
        empty: `${helmName} has no beacons yet.`,
        current: "Current",
        revoke: "Revoke",
        web: "Web",
        app: "App",
        lastSeen: "Last auth",
        expiresAt: "Expires",
        revokeDevice: (deviceName: string) => `Revoke ${deviceName}`,
      }
    : {
        title: "信标",
        count: `${count} 个`,
        empty: `${helmName} 暂无信标。`,
        current: "当前",
        revoke: "撤销",
        web: "网页",
        app: "App",
        lastSeen: "最近",
        expiresAt: "到期",
        revokeDevice: (deviceName: string) => `撤销 ${deviceName}`,
      };
}

function resolveTrustedDeviceRows(
  devices: TrustedDeviceSummary[],
  deckDeviceId: string,
): TrustedDeviceRow[] {
  const nameIndexes = new Map<string, number>();
  return [...devices]
    .sort((left, right) => {
      const createdAtDelta =
        deviceCreatedAtTime(left) - deviceCreatedAtTime(right);
      return createdAtDelta || left.deviceId.localeCompare(right.deviceId);
    })
    .map((device) => {
      const baseName =
        (device.deviceName || "Tiller Deck").trim() || "Tiller Deck";
      const index = nameIndexes.get(baseName) ?? 0;
      nameIndexes.set(baseName, index + 1);
      return {
        ...device,
        displayName: `${baseName}-${index}`,
        isCurrentDevice: device.deviceId === deckDeviceId,
      };
    });
}

function deviceCreatedAtTime(device: TrustedDeviceSummary) {
  const createdAt = Date.parse(device.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}
