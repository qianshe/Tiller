import type { FormEvent } from "react";
import type { ConnectionState } from "../../../store/facade";
import {
  daemonProfileKey,
  type DaemonProfile,
} from "../daemon-profiles";
import {
  DAEMON_HOST_KEY,
  DAEMON_PORT_KEY,
} from "../helm-endpoint";
import type { ConnectToDaemonOptions } from "../sockets";
import { slugify } from "../../agents/facade";

type MutableRef<T> = { current: T };

type UseDaemonProfileActionsOptions = {
  daemonProfileName: string;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  daemonProfiles: DaemonProfile[];
  selectedHelmKey: string;
  helmSocketRefs: MutableRef<Map<string, WebSocket>>;
  manualDisconnectRef: MutableRef<string | null>;
  socketRef: MutableRef<WebSocket | null>;
  lastFilesScopeKeyRef: MutableRef<string | null>;
  addDaemonProfile: (profile: DaemonProfile) => void;
  removeDaemonProfileFromStore: (profile: DaemonProfile) => void;
  removeHelm: (helmKey: string) => void;
  selectHelmKey: (helmKey: string) => void;
  setDaemonHost: (host: string) => void;
  setDaemonPort: (port: string) => void;
  setDaemonProfileName: (name: string) => void;
  setDaemonProfileMessage: (message: string) => void;
  setConnection: (state: ConnectionState) => void;
  connectToDaemon: (
    event?: FormEvent<HTMLFormElement>,
    options?: ConnectToDaemonOptions,
  ) => void;
};

export function useDaemonProfileActions({
  daemonProfileName,
  daemonHost,
  daemonPort,
  defaultDaemonHost,
  defaultDaemonPort,
  daemonProfiles,
  selectedHelmKey,
  helmSocketRefs,
  manualDisconnectRef,
  socketRef,
  lastFilesScopeKeyRef,
  addDaemonProfile,
  removeDaemonProfileFromStore,
  removeHelm,
  selectHelmKey,
  setDaemonHost,
  setDaemonPort,
  setDaemonProfileName,
  setDaemonProfileMessage,
  setConnection,
  connectToDaemon,
}: UseDaemonProfileActionsOptions) {
  function createDaemonProfile(
    nameValue: string,
    hostValue: string,
    portValue: string,
  ): DaemonProfile {
    const host = hostValue.trim() || defaultDaemonHost;
    const port = portValue.trim() || defaultDaemonPort;
    const name = nameValue.trim() || `${host}:${port}`;
    return { id: slugify(`${name}-${host}-${port}`), name, host, port };
  }

  function persistDaemonProfile(profile: DaemonProfile) {
    addDaemonProfile(profile);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(`已保存 Helm：${profile.name}`);
  }

  function saveDaemonProfile() {
    persistDaemonProfile(
      createDaemonProfile(daemonProfileName, daemonHost, daemonPort),
    );
  }

  function removeDaemonProfile(profile: DaemonProfile) {
    const profileKey = daemonProfileKey(profile.host, profile.port);
    const nextProfiles = daemonProfiles.filter(
      (item) => daemonProfileKey(item.host, item.port) !== profileKey,
    );
    const currentHelmKey = daemonProfileKey(
      daemonHost.trim() || defaultDaemonHost,
      daemonPort.trim() || defaultDaemonPort,
    );
    const fallbackProfile = nextProfiles[0];

    helmSocketRefs.current.get(profileKey)?.close();
    helmSocketRefs.current.delete(profileKey);
    removeHelm(profileKey);

    if (currentHelmKey === profileKey) {
      manualDisconnectRef.current = profileKey;
      socketRef.current?.close();
      socketRef.current = null;
      setConnection("disconnected");
      // 手动断开当前 Helm 后，project files 缓存应失效，避免重连后使用过期数据。
      lastFilesScopeKeyRef.current = null;
      const fallbackHost = fallbackProfile?.host ?? defaultDaemonHost;
      const fallbackPort = fallbackProfile?.port ?? defaultDaemonPort;
      setDaemonHost(fallbackHost);
      setDaemonPort(fallbackPort);
      window.localStorage.setItem(DAEMON_HOST_KEY, fallbackHost);
      window.localStorage.setItem(DAEMON_PORT_KEY, fallbackPort);
      selectHelmKey(
        fallbackProfile ? daemonProfileKey(fallbackHost, fallbackPort) : "",
      );
    } else if (selectedHelmKey === profileKey) {
      selectHelmKey(currentHelmKey);
    }

    removeDaemonProfileFromStore(profile);
    setDaemonProfileMessage(`已删除 Helm 前端配置：${profile.name}`);
  }

  function applyDaemonProfile(profile: DaemonProfile) {
    setDaemonHost(profile.host);
    setDaemonPort(profile.port);
    setDaemonProfileName(profile.name);
    setDaemonProfileMessage(`已切换到 ${profile.name}`);
  }

  function connectDaemonProfile(profile: DaemonProfile) {
    applyDaemonProfile(profile);
    selectHelmKey(daemonProfileKey(profile.host, profile.port));
    void connectToDaemon(undefined, {
      preserveState: true,
      host: profile.host,
      port: profile.port,
    });
  }

  return {
    applyDaemonProfile,
    connectDaemonProfile,
    createDaemonProfile,
    persistDaemonProfile,
    removeDaemonProfile,
    saveDaemonProfile,
  };
}
