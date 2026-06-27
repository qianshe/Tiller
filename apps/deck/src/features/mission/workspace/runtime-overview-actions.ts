import type { SessionSummary } from "@tiller/shared";
import { useEffect, useState } from "react";
import { buildRuntimeOverviewItems } from "./runtime-overview";
import { acpReconnectKey, normalizeWorktreePath } from "./runtime-display";

type RpcClientRef = {
  current?: {
    socket: {
      readyState: number;
    };
  } | null;
};

type DispatchToHelm = (client: NonNullable<RpcClientRef["current"]>, method: string, params: unknown) => unknown;

export type RuntimeReconnectTarget = {
  agentId?: string;
  projectId?: string;
  cwd?: string;
  canConnect?: boolean;
  canReconnect?: boolean;
};

export type UseRuntimeOverviewActionsOptions = {
  rpcClientRef: RpcClientRef;
  dispatch?: DispatchToHelm;
  agentConnectionInventory: any[];
  agents: any[];
  worktrees: any[];
  sessions: SessionSummary[];
  projects: any[];
  statuses: Record<string, string>;
  statusLabels: Record<string, string>;
  selectedProjectId: string | null | undefined;
  selectedCwd: string | null | undefined;
  activeSession: SessionSummary | null | undefined;
  activeSessionRestoreGate: { canChat?: boolean } | undefined;
  agentModelOptions: Record<string, any>;
  draftWorktreeOptions: any[];
};

export function useRuntimeOverviewActions(options: UseRuntimeOverviewActionsOptions) {
  const {
    rpcClientRef,
    dispatch,
    agentConnectionInventory,
    agents,
    worktrees,
    sessions,
    projects,
    statuses,
    statusLabels,
    selectedProjectId,
    selectedCwd,
    activeSession,
    activeSessionRestoreGate,
    agentModelOptions,
    draftWorktreeOptions,
  } = options;
  const [pendingAcpReconnects, setPendingAcpReconnects] = useState<Record<string, string | null>>({});

  useEffect(() => {
    setPendingAcpReconnects((current) => {
      let changed = false;
      const next = { ...current };
      for (const connection of agentConnectionInventory) {
        const key = acpReconnectKey(connection.providerId, connection.cwd);
        if (
          key in next &&
          connection.status === "ready" &&
          connection.runtimeConnectionId !== next[key]
        ) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [agentConnectionInventory]);

  const runtimeOverviewItems = buildRuntimeOverviewItems({
    agentConnectionInventory,
    agents,
    worktrees,
    sessions,
    projects,
    statuses,
    statusLabels,
    pendingAcpReconnects,
    selectedProjectId,
    selectedCwd,
    activeSession,
    activeSessionRestoreGate,
    agentModelOptions,
    draftWorktreeOptions,
  });

  const reconnectAcpRuntime = (runtime: RuntimeReconnectTarget) => {
    const client = rpcClientRef?.current;
    if (!runtime.agentId || !client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const reconnectKey = acpReconnectKey(runtime.agentId, runtime.cwd);
    const currentConnection = agentConnectionInventory.find(
      (connection) =>
        connection.providerId === runtime.agentId &&
        normalizeWorktreePath(connection.cwd) === normalizeWorktreePath(runtime.cwd),
    );
    setPendingAcpReconnects((current) => ({
      ...current,
      [reconnectKey]: currentConnection?.runtimeConnectionId ?? null,
    }));
    void dispatch?.(client, runtime.canReconnect ? "agent/reconnect" : "agent/connect", {
      providerId: runtime.agentId,
      projectId: runtime.projectId ?? selectedProjectId ?? undefined,
      cwd: runtime.cwd ?? selectedCwd ?? undefined,
    });
  };

  return {
    runtimeOverviewItems,
    reconnectAcpRuntime,
  };
}
