import type { MutableRefObject } from "react";
import type { TrustedDeviceSummary } from "@tiller/shared";
import type { TrustedDeviceCache } from "../auth/beacon-cache";
import type { DaemonProfile } from "../helm-connection/facade";
import type { DeckRpcClient } from "../helm-connection/rpc-client";
import { useDeckStore } from "../../store";

type FleetAddHelmStage = "connect" | "connecting" | "pair";

export type DeviceServerEventContext = {
  primaryHelmKeyRef: MutableRefObject<string | null>;
  daemonProfileKey: (host: string, port: string) => string;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  deckDeviceId: string;
  pendingAddHelmProfileRef: MutableRefObject<DaemonProfile | null>;
  writeTrustedDeviceCache: (
    storage: Storage,
    host: string,
    port: string,
    cache: TrustedDeviceCache,
  ) => void;
  persistDaemonProfile: (profile: DaemonProfile) => void;
  daemonHostStorageKey: string;
  daemonPortStorageKey: string;
  setSelectedHelmKey: (key: string) => void;
  setFleetAddHelmModalOpen: (open: boolean) => void;
  setFleetAddHelmStage: (stage: FleetAddHelmStage) => void;
  autoConnectAttemptRef: MutableRefObject<string | null>;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  requestInitialSync: (client: DeckRpcClient, sourceHelmKey?: string) => void | Promise<void>;
  readTrustedDeviceCache: (
    storage: Storage,
    host: string,
    port: string,
  ) => TrustedDeviceCache | null;
  clearTrustedDeviceCache: (storage: Storage, host: string, port: string) => void;
};

export function applyDeviceResult(
  method: string,
  result: unknown,
  sourceHelmKey: string,
  context: DeviceServerEventContext,
) {
  const payload = result as Record<string, any>;
  const {
    primaryHelmKeyRef,
    daemonProfileKey,
    daemonHost,
    daemonPort,
    defaultDaemonHost,
    defaultDaemonPort,
    deckDeviceId,
    pendingAddHelmProfileRef,
    writeTrustedDeviceCache,
    persistDaemonProfile,
    daemonHostStorageKey,
    daemonPortStorageKey,
    setFleetAddHelmModalOpen,
    setFleetAddHelmStage,
    autoConnectAttemptRef,
    rpcClientRef,
    requestInitialSync,
    readTrustedDeviceCache,
    clearTrustedDeviceCache,
  } = context;
  const store = useDeckStore.getState();
  const currentEventHelmKey =
    primaryHelmKeyRef.current ??
    daemonProfileKey(
      daemonHost.trim() || defaultDaemonHost,
      daemonPort.trim() || defaultDaemonPort,
    );
  const sourceIsCurrentHelm = sourceHelmKey === currentEventHelmKey;

  switch (method) {
    case "device/pair":
      if (payload.ok && payload.token) {
        const nextCache = {
          deviceId: deckDeviceId,
          token: payload.token,
          trustedUntil: payload.trustedUntil,
          lastAuthenticatedAt: new Date().toISOString(),
        };
        const pairedProfile = pendingAddHelmProfileRef.current;
        const pairedHost = pairedProfile?.host ?? (daemonHost.trim() || defaultDaemonHost);
        const pairedPort = pairedProfile?.port ?? (daemonPort.trim() || defaultDaemonPort);
        writeTrustedDeviceCache(window.localStorage, pairedHost, pairedPort, nextCache);
        if (pairedProfile) {
          persistDaemonProfile(pairedProfile);
          store.setDaemonHost(pairedProfile.host);
          store.setDaemonPort(pairedProfile.port);
          window.localStorage.setItem(daemonHostStorageKey, pairedProfile.host);
          window.localStorage.setItem(daemonPortStorageKey, pairedProfile.port);
          store.selectHelmKey(daemonProfileKey(pairedProfile.host, pairedProfile.port));
          pendingAddHelmProfileRef.current = null;
          setFleetAddHelmModalOpen(false);
          setFleetAddHelmStage("connect");
        }
        store.setTrustedDevice(nextCache);
        autoConnectAttemptRef.current = null;
        store.setPairingFeedback(payload.message);
        store.setPairingState("paired");
        if (rpcClientRef.current) {
          void requestInitialSync(rpcClientRef.current, sourceHelmKey);
        }
      } else {
        store.setPairingFeedback(payload.message);
        store.setPairingState("rejected");
      }
      return true;
    case "device/authenticate":
      if (payload.ok) {
        const existing = readTrustedDeviceCache(
          window.localStorage,
          daemonHost.trim() || defaultDaemonHost,
          daemonPort.trim() || defaultDaemonPort,
        );
        if (existing) {
          const nextCache = {
            ...existing,
            trustedUntil: payload.trustedUntil ?? existing.trustedUntil,
            lastAuthenticatedAt: new Date().toISOString(),
          };
          writeTrustedDeviceCache(
            window.localStorage,
            daemonHost.trim() || defaultDaemonHost,
            daemonPort.trim() || defaultDaemonPort,
            nextCache,
          );
          store.setTrustedDevice(nextCache);
        }
        autoConnectAttemptRef.current = null;
        store.setPairingFeedback(payload.message);
        store.setPairingState("paired");
        if (rpcClientRef.current) {
          void requestInitialSync(rpcClientRef.current, sourceHelmKey);
        }
      } else {
        clearTrustedDeviceCache(
          window.localStorage,
          daemonHost.trim() || defaultDaemonHost,
          daemonPort.trim() || defaultDaemonPort,
        );
        store.setTrustedDevice(null);
        store.setTrustedDevices([]);
        store.setPairingFeedback(payload.message);
        store.setPairingState(payload.requiresPairing ? "input" : "rejected");
      }
      return true;
    case "device/list":
      store.applyHelmInventory(sourceHelmKey, { trustedDevices: payload.devices as TrustedDeviceSummary[] });
      if (sourceIsCurrentHelm) {
        store.setTrustedDevices(payload.devices as TrustedDeviceSummary[]);
      }
      return true;
    case "device/revoke":
      store.applyHelmInventory(sourceHelmKey, {
        trustedDevices: (
          store.helmInventories[sourceHelmKey]?.trustedDevices ?? store.trustedDevices
        ).filter((device) => device.deviceId !== payload.deviceId),
      });
      if (sourceIsCurrentHelm) {
        store.setTrustedDevices((current) =>
          current.filter((device) => device.deviceId !== payload.deviceId),
        );
      }
      store.setPairingFeedback(payload.message);
      if (payload.ok && payload.deviceId === deckDeviceId) {
        clearTrustedDeviceCache(
          window.localStorage,
          daemonHost.trim() || defaultDaemonHost,
          daemonPort.trim() || defaultDaemonPort,
        );
        store.setTrustedDevice(null);
        store.setConnectFeedback("当前设备已被撤销，请重新连接并输入配对码。");
        store.setPairingState("input");
      }
      return true;
    default:
      return false;
  }
}
