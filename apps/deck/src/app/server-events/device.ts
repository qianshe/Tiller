export function handleDeviceServerEvent(
  payload: { type: string; [key: string]: any },
  sourceHelmKey: string,
  context: any,
) {
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
    setDaemonHost,
    setDaemonPort,
    daemonHostStorageKey,
    daemonPortStorageKey,
    setSelectedHelmKey,
    setFleetAddHelmModalOpen,
    setFleetAddHelmStage,
    setTrustedDevice,
    autoConnectAttemptRef,
    setPairingFeedback,
    setPairingState,
    socketRef,
    requestInitialSync,
    readTrustedDeviceCache,
    clearTrustedDeviceCache,
    setTrustedDevices,
    updateHelmInventory,
    helmInventories,
    trustedDevices,
    setConnectFeedback,
  } = context;
  const currentEventHelmKey =
    primaryHelmKeyRef.current ??
    daemonProfileKey(
      daemonHost.trim() || defaultDaemonHost,
      daemonPort.trim() || defaultDaemonPort,
    );
  const sourceIsCurrentHelm = sourceHelmKey === currentEventHelmKey;

  switch (payload.type) {
    case "device.pair.result":
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
          setDaemonHost(pairedProfile.host);
          setDaemonPort(pairedProfile.port);
          window.localStorage.setItem(daemonHostStorageKey, pairedProfile.host);
          window.localStorage.setItem(daemonPortStorageKey, pairedProfile.port);
          setSelectedHelmKey(daemonProfileKey(pairedProfile.host, pairedProfile.port));
          pendingAddHelmProfileRef.current = null;
          setFleetAddHelmModalOpen(false);
          setFleetAddHelmStage("connect");
        }
        setTrustedDevice(nextCache);
        autoConnectAttemptRef.current = null;
        setPairingFeedback(payload.message);
        setPairingState("paired");
        if (socketRef.current) {
          requestInitialSync(socketRef.current);
        }
      } else {
        setPairingFeedback(payload.message);
        setPairingState("rejected");
      }
      return true;
    case "device.auth.result":
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
          setTrustedDevice(nextCache);
        }
        autoConnectAttemptRef.current = null;
        setPairingFeedback(payload.message);
        setPairingState("paired");
        if (socketRef.current) {
          requestInitialSync(socketRef.current);
        }
      } else {
        clearTrustedDeviceCache(
          window.localStorage,
          daemonHost.trim() || defaultDaemonHost,
          daemonPort.trim() || defaultDaemonPort,
        );
        setTrustedDevice(null);
        setTrustedDevices([]);
        setPairingFeedback(payload.message);
        setPairingState(payload.requiresPairing ? "input" : "rejected");
      }
      return true;
    case "device.list.result":
      updateHelmInventory(sourceHelmKey, { trustedDevices: payload.devices });
      if (sourceIsCurrentHelm) {
        setTrustedDevices(payload.devices);
      }
      return true;
    case "device.revoke.result":
      updateHelmInventory(sourceHelmKey, {
        trustedDevices: (
          helmInventories[sourceHelmKey]?.trustedDevices ?? trustedDevices
        ).filter((device: any) => device.deviceId !== payload.deviceId),
      });
      if (sourceIsCurrentHelm) {
        setTrustedDevices((current: any[]) =>
          current.filter((device) => device.deviceId !== payload.deviceId),
        );
      }
      setPairingFeedback(payload.message);
      if (payload.ok && payload.deviceId === deckDeviceId) {
        clearTrustedDeviceCache(
          window.localStorage,
          daemonHost.trim() || defaultDaemonHost,
          daemonPort.trim() || defaultDaemonPort,
        );
        setTrustedDevice(null);
        setConnectFeedback("当前设备已被撤销，请重新连接并输入配对码。");
        setPairingState("input");
      }
      return true;
    default:
      return false;
  }
}
