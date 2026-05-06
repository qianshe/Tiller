// @ts-nocheck
import type { FormEvent } from "react";
import type { ClientToHelm } from "@tiller/sync-protocol";
import type { DaemonProfile } from "../daemon-profiles";
import type {
  ConnectionState,
  HelmInventoryBucket,
} from "../../../store/facade";
import { readTrustedDeviceCache } from "../../auth/beacon-cache";
import {
  connectHelmSocket as connectHelmSocketImpl,
  connectToDaemon as connectToDaemonImpl,
  type ConnectToDaemonOptions,
} from "../sockets";
import {
  dispatchLegacyPayloadWithTrace,
  dispatchWithTrace,
  nextRequestId,
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
    requestCounter,
    primaryHelmKeyRef,
    manualDisconnectRef,
    socketRef,
    setSessions,
    setStatuses,
    setMessages,
    setPermissionRequests,
    setOutputs,
    toolCallsRef,
    setToolCalls,
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

  function resolveHelmKeyForSocket(socket: WebSocket) {
    if (socket === socketRef.current) {
      return `${daemonHost.trim() || DEFAULT_DAEMON_HOST}:${daemonPort.trim() || DEFAULT_DAEMON_PORT}`;
    }
    for (const [helmKey, candidate] of helmSocketRefs.current) {
      if (candidate === socket) return helmKey;
    }
    return `${daemonHost.trim() || DEFAULT_DAEMON_HOST}:${daemonPort.trim() || DEFAULT_DAEMON_PORT}`;
  }

  function resolveClientForSocket(socket: WebSocket) {
    if (socket === socketRef.current) return rpcClientRef.current;
    return helmRpcClientRefs.current.get(resolveHelmKeyForSocket(socket)) ?? null;
  }

  function dispatch(socket: WebSocket, payload: ClientToHelm) {
    const client = resolveClientForSocket(socket);
    if (!client) return;
    const helmKey = resolveHelmKeyForSocket(socket);
    void dispatchLegacyPayloadWithTrace(client, payload, setDebugTrace, (method, result) => {
      handlers.handleRpcResult(method, result, helmKey);
    });
  }

  function dispatchRpc(client: any, method: string, params: unknown, sourceHelmKey?: string) {
    return dispatchWithTrace(client, method, params, setDebugTrace, (resultMethod, result) => {
      handlers.handleRpcResult(resultMethod, result, sourceHelmKey);
    });
  }

  function requestInitialSync(client: any, sourceHelmKey?: string) {
    return requestInitialSyncImpl(client, {
      dispatch: async (targetClient, method, params) => {
        await dispatchRpc(targetClient, method, params, sourceHelmKey);
      },
      setSessionHistoryState,
      sessionPageLimit: DEFAULT_SESSION_PAGE_LIMIT,
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
      nextRequestId,
      requestCounter,
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
      setPermissionRequests,
      setOutputs,
      toolCallsRef,
      setToolCalls,
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
      nextRequestId,
      requestCounter,
      requestInitialSync,
      lastFilesScopeKeyRef,
      handleRpcResult: handlers.handleRpcResult,
      handleRpcNotification: handlers.handleRpcNotification,
    });
  }

  return {
    connectHelmSocket,
    connectToDaemon,
    dispatch,
    requestInitialSync,
    setHelmConnectionState,
    updateHelmInventory,
  };
}
