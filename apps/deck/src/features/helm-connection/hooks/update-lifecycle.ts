import { useEffect } from "react";
import type { HelmUpdateState } from "../../../store/facade";
import { useDeckStore } from "../../../store";
import {
  clearHelmUpdateIntent,
  isHelmVersionAtLeast,
} from "../update-intent";

export type HelmUpdateLifecycleDecision = "idle" | "reload" | "recover";

export function resolveHelmUpdateLifecycleDecision(input: {
  connection: string;
  update: HelmUpdateState | null;
}): HelmUpdateLifecycleDecision {
  const targetVersion = input.update?.targetVersion;
  if (input.update?.status !== "restarting" || !targetVersion) {
    return "idle";
  }
  if (
    input.connection === "connected" &&
    isHelmVersionAtLeast(input.update.currentVersion, targetVersion)
  ) {
    return "reload";
  }
  return "recover";
}

export function useHelmUpdateLifecycle(input: {
  connection: string;
  helmKey: string;
  update: HelmUpdateState | null;
}) {
  const { connection, helmKey, update } = input;

  useEffect(() => {
    const decision = resolveHelmUpdateLifecycleDecision({ connection, update });
    const targetVersion = update?.targetVersion;
    if (decision === "idle" || !targetVersion) {
      return;
    }
    if (decision === "reload") {
      clearHelmUpdateIntent(helmKey);
      const refreshTimer = window.setTimeout(() => window.location.reload(), 0);
      return () => window.clearTimeout(refreshTimer);
    }

    const reconnectTimer = window.setTimeout(() => {
      const current = useDeckStore.getState().helmInventories[helmKey]?.update;
      if (current?.status === "restarting") {
        useDeckStore.getState().applyHelmInventory(helmKey, {
          update: {
            ...current,
            status: "failed",
            message: "Helm 重连超时，请检查服务状态并执行手动升级命令。",
          },
        });
      }
      clearHelmUpdateIntent(helmKey);
    }, 30_000);
    return () => window.clearTimeout(reconnectTimer);
  }, [connection, helmKey, update?.currentVersion, update?.status, update?.targetVersion]);
}
