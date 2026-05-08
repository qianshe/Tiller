import { Badge, Button } from "@/shared/ui";
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
    <section className="grid gap-3 border-t border-border-ghost pt-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 text-base font-semibold text-foreground">{labels.title}</h3>
        <span className="text-sm text-muted-foreground">{labels.count}</span>
      </div>
      {deviceRows.length ? (
        <ul className="m-0 grid list-none divide-y divide-border-ghost p-0">
          {deviceRows.map((device) => (
            <li
              key={device.deviceId}
              className="grid min-h-12 grid-cols-[minmax(150px,1fr)_auto_auto_minmax(132px,auto)_minmax(132px,auto)_auto] items-center gap-2 py-2 text-sm text-muted-foreground max-xl:grid-cols-[minmax(0,1fr)_auto_auto] max-xl:[grid-template-areas:'name_kind_action'_'last_expires_action'_'current_current_action'] max-md:grid-cols-1 max-md:[grid-template-areas:'name'_'kind'_'current'_'last'_'expires'_'action']"
            >
              <strong
                className="min-w-0 truncate text-foreground [grid-area:name]"
                title={device.displayName}
              >
                {device.displayName}
              </strong>
              <Badge variant="outline" className="justify-self-start [grid-area:kind]">
                {device.clientKind === "app" ? labels.app : labels.web}
              </Badge>
              {device.isCurrentDevice ? (
                <Badge className="justify-self-start [grid-area:current]">
                  {labels.current}
                </Badge>
              ) : null}
              <span className="whitespace-nowrap [grid-area:last]">
                {labels.lastSeen} · {formatDeviceTime(device.lastSeenAt)}
              </span>
              <span className="whitespace-nowrap [grid-area:expires]">
                {labels.expiresAt} · {formatDeviceTime(device.expiresAt)}
              </span>
              <Button
                aria-label={labels.revokeDevice(device.displayName)}
                variant="outline"
                size="sm"
                className="justify-self-end max-md:w-full max-md:justify-self-stretch [grid-area:action]"
                type="button"
                onClick={() => onRevokeDevice(device.deviceId, targetSocket)}
              >
                {labels.revoke}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-16 place-items-center rounded-md bg-surface-sunken px-4 text-sm text-muted-foreground">
          {labels.empty}
        </div>
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

function deviceCreatedAtTime(device: TrustedDeviceSummary): number {
  const createdAt = Date.parse(device.createdAt);
  return Number.isNaN(createdAt) ? 0 : createdAt;
}
