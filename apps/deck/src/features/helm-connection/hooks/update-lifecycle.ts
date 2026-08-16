import { useEffect } from "react";
import type { HelmUpdateState } from "../../../store/facade";
import { useDeckStore } from "../../../store";
import {
  clearHelmUpdateIntent,
  isHelmVersionAtLeast,
  readHelmUpdateIntent,
} from "../update-intent";

export type HelmUpdateLifecycleDecision = "idle" | "complete" | "recover";

export function resolveHelmUpdateLifecycleDecision(input: {
  connection: string;
  update: HelmUpdateState | null;
  hasPendingUpdateIntent: boolean;
}): HelmUpdateLifecycleDecision {
  const targetVersion = input.update?.targetVersion;
  if (
    input.update?.status !== "restarting" ||
    !targetVersion ||
    !input.hasPendingUpdateIntent
  ) {
    return "idle";
  }
  if (
    input.connection === "connected" &&
    isHelmVersionAtLeast(input.update.currentVersion, targetVersion)
  ) {
    return "complete";
  }
  return "recover";
}

export function useHelmUpdateLifecycle(input: {
  connection: string;
  helmKey: string;
  update: HelmUpdateState | null;
}): void {
  const { connection, helmKey, update } = input;

  useEffect(() => {
    const decision = resolveHelmUpdateLifecycleDecision({
      connection,
      update,
      hasPendingUpdateIntent: Boolean(readHelmUpdateIntent(helmKey)),
    });
    const targetVersion = update?.targetVersion;
    if (decision === "idle" || !targetVersion) {
      return;
    }
    if (decision === "complete") {
      const current = useDeckStore.getState().helmInventories[helmKey]?.update;
      if (current?.status === "restarting") {
        useDeckStore.getState().applyHelmInventory(helmKey, {
          update: {
            ...current,
            status: "up-to-date",
            targetVersion: undefined,
            updateAvailable: false,
            message: "Helm 更新完成。",
          },
        });
      }
      clearHelmUpdateIntent(helmKey);
      return;
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
