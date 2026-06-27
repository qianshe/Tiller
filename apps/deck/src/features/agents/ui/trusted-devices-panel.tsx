import { Badge, Button } from "@/shared/ui";
import type { TrustedDeviceSummary } from "@tiller/shared";
import type { DeckLanguage } from "../../preferences";
import { formatDeviceTime } from "../../../shared/utils/format-time";
import { InventoryTable } from "./inventory-table";

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
    <InventoryTable
      title={labels.title}
      countLabel={labels.count}
      rows={deviceRows.map((device) => ({
        key: device.deviceId,
        title: device.displayName,
        subtitle: `${labels.lastSeen} · ${formatDeviceTime(device.lastSeenAt)}`,
        badge: (
          <>
            <Badge variant="outline">
              {device.clientKind === "app" ? labels.app : labels.web}
            </Badge>
            {device.isCurrentDevice ? <Badge>{labels.current}</Badge> : null}
          </>
        ),
        meta: `${labels.expiresAt} · ${formatDeviceTime(device.expiresAt)}`,
        actions: (
          <Button
            aria-label={labels.revokeDevice(device.displayName)}
            variant="outline"
            size="sm"
            type="button"
            onClick={() => onRevokeDevice(device.deviceId, targetSocket)}
          >
            {labels.revoke}
          </Button>
        ),
      }))}
      emptyLabel={labels.empty}
    />
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

function deviceCreatedAtTime(device: TrustedDeviceSummary): number {
  const createdAt = Date.parse(device.createdAt);
  return Number.isNaN(createdAt) ? 0 : createdAt;
}
