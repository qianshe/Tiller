// @ts-nocheck
import type { FormEvent } from "react";
import type { DaemonProfile } from "../daemon-profiles";
import type {
  ConnectionState,
  HelmInventoryBucket,
} from "../../../store/facade";
import { useDeckStore } from "../../../store";
import { readTrustedDeviceCache } from "../../auth/beacon-cache";
import {
  connectHelmSocket as connectHelmSocketImpl,
  connectToDaemon as connectToDaemonImpl,
  type ConnectToDaemonOptions,
} from "../sockets";
import {
  dispatchWithTrace,
  requestInitialSync as requestInitialSyncImpl,
} from "../request-dispatch";
import { DEFAULT_SESSION_PAGE_LIMIT } from "../../mission/config";
import {
  DEFAULT_DAEMON_HOST,
  DEFAULT_DAEMON_PORT,
} from "../../../shared/config/deck-runtime";

export function createSocketController(
  source: any,
  handlers: {
    handleServerEvent: (payload: any, sourceHelmKey?: string) => void;
    handleRpcResult: (method: string, result: unknown, sourceHelmKey?: string) => void;
    handleRpcNotification: (method: string, params: unknown, sourceHelmKey?: string) => void;
  },
) {
  const {
    setSessionHistoryState,
    setHelmConnection,
    applyHelmInventory,
    helmSocketRefs,
    helmRpcClientRefs,
    rpcClientRef,
    setDaemonProfileMessage,
    primaryHelmKeyRef,
    manualDisconnectRef,
    socketRef,
    setSessions,
    setStatuses,
    setMessages,
    setOutputs,
    toolCallsRef,
    setToolCalls,
    setSessionPlans,
    setDiffs,
    setSessionConfigOptions,
    setTrustedDevices,
    setActiveSessionId,
    setSelectedProjectId,
    setResumeFeedback,
    setDebugTrace,
    setConnection,
    setConnectFeedback,
    copy,
    setPairingState,
    setPairingCodeInput,
    setPairingFeedback,
    pairingState,
    setTrustedDevice,
    lastFilesScopeKeyRef,
    daemonHost,
    daemonPort,
  } = source;

  function dispatchRpc(
    client: any,
    method: string,
    params: unknown,
    optionsOrSourceHelmKey?: { onResult?: (method: string, result: unknown) => void } | string,
    explicitSourceHelmKey?: string,
  ) {
    const sourceHelmKey = typeof optionsOrSourceHelmKey === "string"
      ? optionsOrSourceHelmKey
      : explicitSourceHelmKey;
    const onResult = typeof optionsOrSourceHelmKey === "object"
      ? optionsOrSourceHelmKey.onResult
      : undefined;
    return dispatchWithTrace(client, method, params, setDebugTrace, (resultMethod, result) => {
      handlers.handleRpcResult(resultMethod, result, sourceHelmKey);
      onResult?.(resultMethod, result);
    });
  }

  function requestInitialSync(client: any, sourceHelmKey?: string) {
    return requestInitialSyncImpl(client, {
      dispatch: async (targetClient, method, params) => {
        await dispatchRpc(targetClient, method, params, undefined, sourceHelmKey);
      },
      setSessionHistoryState,
      sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
      onUpdateCheckError: (error) => {
        const helmKey = sourceHelmKey ?? primaryHelmKeyRef.current ?? daemonProfileKey(
          daemonHost.trim() || DEFAULT_DAEMON_HOST,
          daemonPort.trim() || DEFAULT_DAEMON_PORT,
        );
        const previous = useDeckStore.getState().helmInventories[helmKey]?.update;
        applyHelmInventory(helmKey, {
          update: {
            ...(previous ?? {
              currentVersion: "未知",
              updateAvailable: false,
              canUpdate: false,
            }),
            status: "failed",
            checkStatus: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      },
    });
  }

  function setHelmConnectionState(helmKey: string, state: ConnectionState) {
    setHelmConnection(helmKey, state);
  }

  function updateHelmInventory(
    helmKey: string,
    patch: Partial<HelmInventoryBucket>,
  ) {
    applyHelmInventory(helmKey, patch);
  }

  function connectHelmSocket(profile: DaemonProfile) {
    connectHelmSocketImpl(profile, {
      embedded: import.meta.env.VITE_TILLER_EMBEDDED_HELM === "true",
      location: window.location,
      helmSocketRefs,
      helmRpcClientRefs,
      setHelmConnectionState,
      setDaemonProfileMessage,
      readTrustedDeviceCache,
      requestInitialSync,
      dispatch: dispatchRpc,
      handleRpcResult: handlers.handleRpcResult,
      handleRpcNotification: handlers.handleRpcNotification,
    });
  }

  function connectToDaemon(
    event?: FormEvent<HTMLFormElement>,
    options?: ConnectToDaemonOptions,
  ) {
    connectToDaemonImpl(event, options, {
      embedded: import.meta.env.VITE_TILLER_EMBEDDED_HELM === "true",
      location: window.location,
      daemonHost,
      daemonPort,
      defaultDaemonHost: DEFAULT_DAEMON_HOST,
      defaultDaemonPort: DEFAULT_DAEMON_PORT,
      primaryHelmKeyRef,
      manualDisconnectRef,
      socketRef,
      rpcClientRef,
      setSessions,
      setStatuses,
      setMessages,
      setOutputs,
      toolCallsRef,
      setToolCalls,
      setSessionPlans,
      setDiffs,
      setSessionConfigOptions,
      setTrustedDevices,
      setActiveSessionId,
      setSelectedProjectId,
      setResumeFeedback,
      setDebugTrace,
      setHelmConnectionState,
      setConnection,
      setConnectFeedback,
      copy,
      setPairingState,
      setPairingCodeInput,
      setPairingFeedback,
      pairingState,
      setTrustedDevice,
      readTrustedDeviceCache,
      dispatch: dispatchRpc,
      requestInitialSync,
      lastFilesScopeKeyRef,
      handleRpcResult: handlers.handleRpcResult,
      handleRpcNotification: handlers.handleRpcNotification,
    });
  }

  return {
    connectHelmSocket,
    connectToDaemon,
    dispatch: dispatchRpc,
    requestInitialSync,
    setHelmConnectionState,
    updateHelmInventory,
  };
}
