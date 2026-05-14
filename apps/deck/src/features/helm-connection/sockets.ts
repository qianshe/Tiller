import type { FormEvent, MutableRefObject } from "react";
import type {
  AgentMessage,
  AgentToolCall,
  CommandChunk,
  FileDiffSummary,
  SessionConfigOption,
  SessionStatus,
  SessionSummary,
  TrustedDeviceSummary,
} from "@tiller/shared";
import type { TrustedDeviceCache } from "../auth/beacon-cache";
import type {
  ConnectionState,
  DebugTrace,
  PairingState,
} from "../../store/facade";
import { useDeckStore } from "../../store";
import { daemonProfileKey, type DaemonProfile } from "./daemon-profiles";
import { createHelmWebSocketUrl, DAEMON_HOST_KEY, DAEMON_PORT_KEY } from "./helm-endpoint";
import { DeckRpcClient } from "./rpc-client";
import type { DispatchToHelm } from "./request-dispatch";

type StoreUpdater<T> = T | ((current: T) => T);
type StoreSetter<T> = (updater: StoreUpdater<T>) => void;
type ReadTrustedDeviceCache = (
  storage: Storage,
  host: string,
  port: string,
) => TrustedDeviceCache | null;

type RpcHandlers = {
  handleRpcResult: (method: string, result: unknown, sourceHelmKey?: string) => void;
  handleRpcNotification: (method: string, params: unknown, sourceHelmKey?: string) => void;
};

type ConnectHelmSocketContext = RpcHandlers & {
  embedded: boolean;
  location: Location;
  helmSocketRefs: MutableRefObject<Map<string, WebSocket>>;
  helmRpcClientRefs: MutableRefObject<Map<string, DeckRpcClient>>;
  setHelmConnectionState: (helmKey: string, state: ConnectionState) => void;
  setDaemonProfileMessage: (value: string) => void;
  readTrustedDeviceCache: ReadTrustedDeviceCache;
  requestInitialSync: (client: DeckRpcClient, sourceHelmKey?: string) => void | Promise<void>;
  dispatch: DispatchToHelm;
};

type ConnectToDaemonContext = RpcHandlers & {
  embedded: boolean;
  location: Location;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  primaryHelmKeyRef: MutableRefObject<string | null>;
  manualDisconnectRef: MutableRefObject<string | null>;
  socketRef: MutableRefObject<WebSocket | null>;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  setSessions: StoreSetter<SessionSummary[]>;
  setStatuses: StoreSetter<Record<string, SessionStatus>>;
  setMessages: StoreSetter<Record<string, AgentMessage[]>>;
  setOutputs: StoreSetter<Record<string, CommandChunk[]>>;
  toolCallsRef: MutableRefObject<Record<string, AgentToolCall[]>>;
  setToolCalls: StoreSetter<Record<string, AgentToolCall[]>>;
  setDiffs: StoreSetter<Record<string, FileDiffSummary[]>>;
  setSessionConfigOptions: StoreSetter<Record<string, SessionConfigOption[]>>;
  setTrustedDevices: StoreSetter<TrustedDeviceSummary[]>;
  setActiveSessionId: StoreSetter<string | null>;
  setSelectedProjectId: (projectId: string | null) => void;
  setResumeFeedback: (value: string) => void;
  setDebugTrace: (updater: (current: DebugTrace) => DebugTrace) => void;
  setHelmConnectionState: (helmKey: string, state: ConnectionState) => void;
  setConnection: (state: ConnectionState) => void;
  setConnectFeedback: (value: string) => void;
  copy: {
    connectFeedbackConnecting: string;
    connectFeedbackIdle: string;
    pairingFeedbackIdle: string;
  };
  setPairingState: (state: PairingState) => void;
  setPairingCodeInput: (value: string) => void;
  setPairingFeedback: (value: string) => void;
  pairingState: PairingState;
  setTrustedDevice: (cache: TrustedDeviceCache | null) => void;
  readTrustedDeviceCache: ReadTrustedDeviceCache;
  dispatch: DispatchToHelm;
  requestInitialSync: (client: DeckRpcClient, sourceHelmKey?: string) => void | Promise<void>;
  lastFilesScopeKeyRef: MutableRefObject<string | null>;
};

export type ConnectToDaemonOptions = {
  preserveState?: boolean;
  auto?: boolean;
  host?: string;
  port?: string;
  persistEndpoint?: boolean;
};

function createRpcClient(socket: WebSocket, helmKey: string, handlers: RpcHandlers) {
  return new DeckRpcClient(
    socket,
    (method, params) => handlers.handleRpcNotification(method, params, helmKey),
    (error) => {
      handlers.handleRpcNotification(
        "error/raised",
        { message: error instanceof Error ? error.message : String(error) },
        helmKey,
      );
    },
  );
}

export function connectHelmSocket(profile: DaemonProfile, context: ConnectHelmSocketContext) {
  const {
    embedded,
    location,
    helmSocketRefs,
    helmRpcClientRefs,
    setHelmConnectionState,
    setDaemonProfileMessage,
    readTrustedDeviceCache,
    requestInitialSync,
    dispatch,
    handleRpcResult,
    handleRpcNotification,
  } = context;

  const helmKey = daemonProfileKey(profile.host, profile.port);
  const existing = helmSocketRefs.current.get(helmKey);
  if (existing?.readyState === WebSocket.OPEN) {
    setHelmConnectionState(helmKey, "connected");
    setDaemonProfileMessage(`${profile.name} 已连接`);
    return;
  }
  existing?.close();
  helmRpcClientRefs.current.get(helmKey)?.close();

  const wsUrl = createHelmWebSocketUrl({
    embedded,
    host: profile.host,
    port: profile.port,
    location,
  });
  const socket = new WebSocket(wsUrl);
  const client = createRpcClient(socket, helmKey, { handleRpcResult, handleRpcNotification });
  helmSocketRefs.current.set(helmKey, socket);
  helmRpcClientRefs.current.set(helmKey, client);
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
      void requestInitialSync(client, helmKey);
      return;
    }
    if (cache?.token) {
      void dispatch(client, "device/authenticate", {
        deviceId: cache.deviceId,
        token: cache.token,
      }, {
        onResult: () => {
          void requestInitialSync(client, helmKey);
        },
      });
    }
  });

  socket.addEventListener("close", () => {
    if (helmSocketRefs.current.get(helmKey) !== socket) {
      return;
    }
    helmSocketRefs.current.delete(helmKey);
    if (helmRpcClientRefs.current.get(helmKey) === client) {
      helmRpcClientRefs.current.delete(helmKey);
    }
    setHelmConnectionState(helmKey, "disconnected");
  });

  socket.addEventListener("error", () => {
    if (helmSocketRefs.current.get(helmKey) !== socket) {
      return;
    }
    setHelmConnectionState(helmKey, "disconnected");
    setDaemonProfileMessage(`${profile.name} 连接失败`);
  });
}

export function connectToDaemon(
  event: FormEvent<HTMLFormElement> | undefined,
  options: ConnectToDaemonOptions | undefined,
  context: ConnectToDaemonContext,
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
    rpcClientRef,
    setSessions,
    setStatuses,
    setMessages,
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
    requestInitialSync,
    lastFilesScopeKeyRef,
    handleRpcResult,
    handleRpcNotification,
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
  rpcClientRef.current?.close();
  socketRef.current?.close();
  if (!preserveState) {
    setSessions([]);
    setStatuses({});
    setMessages({});
    useDeckStore.getState().replacePendingApprovals([]);
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
  setDebugTrace((current) => ({
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
  const client = createRpcClient(socket, helmKey, { handleRpcResult, handleRpcNotification });
  socketRef.current = socket;
  rpcClientRef.current = client;

  socket.addEventListener("open", () => {
    setHelmConnectionState(helmKey, "connected");
    setConnection("connected");
    setConnectFeedback(`已连接到 ${wsUrl}`);
    const cache = readTrustedDeviceCache(window.localStorage, host, port);
    if (cache?.token) {
      setTrustedDevice(cache);
      void dispatch(client, "device/authenticate", {
        deviceId: cache.deviceId,
        token: cache.token,
      }, {
        onResult: () => {
          void requestInitialSync(client, helmKey);
        },
      });
      setPairingState("waiting");
      setPairingFeedback("正在使用已保存令牌认证...");
      return;
    }
    setPairingState("paired");
    setPairingFeedback("已连接,正在加载...");
    void requestInitialSync(client, helmKey);
  });

  socket.addEventListener("close", () => {
    if (socketRef.current !== socket) {
      return;
    }
    setHelmConnectionState(helmKey, "disconnected");
    setConnection("disconnected");
    socketRef.current = null;
    if (rpcClientRef.current === client) {
      rpcClientRef.current = null;
    }
    lastFilesScopeKeyRef.current = null;
    setConnectFeedback(copy.connectFeedbackIdle);
    if (context.pairingState !== "paired") {
      setPairingState("idle");
    }
  });

  socket.addEventListener("error", () => {
    if (socketRef.current !== socket) {
      return;
    }
    setConnection("disconnected");
    setConnectFeedback(`连接 ${wsUrl} 失败`);
    if (!options?.auto) {
      setPairingState("idle");
    }
    lastFilesScopeKeyRef.current = null;
  });
}
