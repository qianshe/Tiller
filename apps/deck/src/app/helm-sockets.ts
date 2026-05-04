import type { FormEvent } from "react";
import type { HelmToClient } from "@tiller/sync-protocol";
import { daemonProfileKey, type DaemonProfile } from "./daemon-profiles";
import { createHelmWebSocketUrl, DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "./helm-endpoint";

export type ConnectToDaemonOptions = {
  preserveState?: boolean;
  auto?: boolean;
  host?: string;
  port?: string;
  persistEndpoint?: boolean;
};

export function connectHelmSocket(profile: DaemonProfile, context: any) {
  const {
    embedded,
    location,
    helmSocketRefs,
    setHelmConnectionState,
    setDaemonProfileMessage,
    readTrustedDeviceCache,
    requestInitialSync,
    dispatch,
    nextRequestId,
    requestCounter,
    handleServerEvent,
  } = context;

  const helmKey = daemonProfileKey(profile.host, profile.port);
  const existing = helmSocketRefs.current.get(helmKey);
  if (existing?.readyState === WebSocket.OPEN) {
    setHelmConnectionState(helmKey, "connected");
    setDaemonProfileMessage(`${profile.name} 已连接`);
    return;
  }
  existing?.close();

  const wsUrl = createHelmWebSocketUrl({
    embedded,
    host: profile.host,
    port: profile.port,
    location,
  });
  const socket = new WebSocket(wsUrl);
  helmSocketRefs.current.set(helmKey, socket);
  setHelmConnectionState(helmKey, "connecting");
  setDaemonProfileMessage(`正在连接 ${profile.name}...`);

  socket.addEventListener("open", () => {
    setHelmConnectionState(helmKey, "connected");
    setDaemonProfileMessage(`已连接 ${profile.name}`);
    const cache = readTrustedDeviceCache(
      window.localStorage,
      profile.host,
      profile.port,
    );
    if (embedded) {
      requestInitialSync(socket);
      return;
    }
    if (cache?.token) {
      dispatch(socket, {
        type: "device.auth",
        requestId: nextRequestId(requestCounter),
        deviceId: cache.deviceId,
        token: cache.token,
      });
      requestInitialSync(socket);
    }
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data)) as HelmToClient;
    handleServerEvent(payload, helmKey);
  });

  socket.addEventListener("close", () => {
    if (helmSocketRefs.current.get(helmKey) === socket) {
      helmSocketRefs.current.delete(helmKey);
    }
    setHelmConnectionState(helmKey, "disconnected");
  });

  socket.addEventListener("error", () => {
    setHelmConnectionState(helmKey, "disconnected");
    setDaemonProfileMessage(`${profile.name} 连接失败`);
  });
}

export function connectToDaemon(
  event: FormEvent<HTMLFormElement> | undefined,
  options: ConnectToDaemonOptions | undefined,
  context: any,
) {
  const {
    embedded,
    location,
    daemonHost,
    daemonPort,
    defaultDaemonHost,
    defaultDaemonPort,
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
    setHelmConnectionState,
    setConnection,
    setConnectFeedback,
    copy,
    setPairingState,
    setPairingCodeInput,
    setPairingFeedback,
    setTrustedDevice,
    readTrustedDeviceCache,
    dispatch,
    nextRequestId,
    requestCounter,
    requestInitialSync,
    lastFilesScopeKeyRef,
    handleServerEvent,
  } = context;

  event?.preventDefault();
  const preserveState = options?.preserveState ?? false;
  const host = options?.host?.trim() || daemonHost.trim() || defaultDaemonHost;
  const port = options?.port?.trim() || daemonPort.trim() || defaultDaemonPort;
  const helmKey = daemonProfileKey(host, port);
  const wsUrl = createHelmWebSocketUrl({
    embedded,
    host,
    port,
    location,
  });
  primaryHelmKeyRef.current = helmKey;

  if (!options?.auto) {
    manualDisconnectRef.current = null;
  }

  if (!embedded && (options?.persistEndpoint ?? true)) {
    window.localStorage.setItem(DAEMON_HOST_KEY, host);
    window.localStorage.setItem(DAEMON_PORT_KEY, port);
  }
  socketRef.current?.close();
  if (!preserveState) {
    setSessions([]);
    setStatuses({});
    setMessages({});
    setPermissionRequests({});
    setOutputs({});
    toolCallsRef.current = {};
    setToolCalls({});
    setDiffs({});
    setSessionConfigOptions({});
    setTrustedDevices([]);
    setActiveSessionId(null);
    setSelectedProjectId(null);
    setResumeFeedback("");
  }
  setDebugTrace((current: any) => ({
    ...current,
    connectClicks: current.connectClicks + 1,
  }));
  setHelmConnectionState(helmKey, "connecting");
  setConnection("connecting");
  setConnectFeedback(`${copy.connectFeedbackConnecting} (${wsUrl})`);
  setPairingState("idle");
  setPairingCodeInput("");
  setPairingFeedback(copy.pairingFeedbackIdle);

  const socket = new WebSocket(wsUrl);
  socketRef.current = socket;

  socket.addEventListener("open", () => {
    setHelmConnectionState(helmKey, "connected");
    setConnection("connected");
    setConnectFeedback(`已连接到 ${wsUrl}`);
    const cache = readTrustedDeviceCache(window.localStorage, host, port);
    // Prefer the cached trusted-device path - it lets pairing-auth helms
    // re-authenticate silently and sync after `device.auth.result` arrives.
    if (cache?.token) {
      setTrustedDevice(cache);
      dispatch(socket, {
        type: "device.auth",
        requestId: nextRequestId(requestCounter),
        deviceId: cache.deviceId,
        token: cache.token,
      });
      setPairingState("waiting");
      setPairingFeedback("正在使用已保存令牌认证...");
      return;
    }
    // No cached token: optimistically pull initial state. Personal-auth helms
    // (`AUTH_MODE === "none"`) admit the socket immediately, so this is the
    // only way for a fresh deck (e.g. vite dev on :5173 talking to local
    // helm on :47631) to populate projects/sessions. Pairing-auth helms will
    // reply with `error: not authenticated` and the error handler below will
    // surface the pairing input.
    setPairingState("paired");
    setPairingFeedback("已连接,正在加载...");
    requestInitialSync(socket);
  });

  socket.addEventListener("close", () => {
    setHelmConnectionState(helmKey, "disconnected");
    setConnection("disconnected");
    if (socketRef.current === socket) {
      socketRef.current = null;
    }
    // Socket 断开后,project files 缓存可能与服务器状态分叉 — 重连后强制刷新一次。
    lastFilesScopeKeyRef.current = null;
    setConnectFeedback(copy.connectFeedbackIdle);
    if (context.pairingState !== "paired") {
      setPairingState("idle");
    }
  });

  socket.addEventListener("error", () => {
    setConnection("disconnected");
    setConnectFeedback(`连接 ${wsUrl} 失败`);
    if (!options?.auto) {
      setPairingState("idle");
    }
    // Socket 异常断开后，project files 缓存可能过期 — 重连后强制刷新一次。
    lastFilesScopeKeyRef.current = null;
  });

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data)) as HelmToClient;
    handleServerEvent(payload, helmKey);
  });
}
