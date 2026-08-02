import type { MutableRefObject } from "react";
import type { HelmInventoryBucket, HelmUpdateState } from "../../../store/facade";
import type { DispatchToHelm } from "../request-dispatch";
import type { DeckRpcClient } from "../rpc-client";
import {
  clearHelmUpdateIntent,
  readHelmUpdateIntent,
  writeHelmUpdateIntent,
} from "../update-intent";

const MANUAL_UPDATE_COMMAND = "npm install -g @qianshe/tiller@latest";

export type HelmUpdateTarget = {
  client: DeckRpcClient;
  helmKey: string;
};

type HelmUpdateRuntimeRefs = {
  primaryHelmKeyRef: MutableRefObject<string | null>;
  rpcClientRef: MutableRefObject<DeckRpcClient | null>;
  helmRpcClientRefs: MutableRefObject<Map<string, DeckRpcClient>>;
};

type HelmUpdateInventory = {
  helmInventories: Record<string, HelmInventoryBucket>;
  applyHelmInventory: (
    helmKey: string,
    patch: Partial<HelmInventoryBucket>,
  ) => void;
};

export function createHelmUpdateActions(input: {
  runtime: HelmUpdateRuntimeRefs;
  inventory: HelmUpdateInventory;
  resolveCurrentHelmKey: () => string;
  dispatch: DispatchToHelm;
  formatError: (error: unknown) => string;
}) {
  function resolveHelmKey() {
    return input.runtime.primaryHelmKeyRef.current ?? input.resolveCurrentHelmKey();
  }

  function resolveTarget(): HelmUpdateTarget | null {
    const helmKey = resolveHelmKey();
    const directClient = input.runtime.rpcClientRef.current;
    if (directClient && isSocketOpen(directClient)) {
      return { client: directClient, helmKey };
    }
    const profileClient = input.runtime.helmRpcClientRefs.current.get(helmKey);
    if (profileClient && isSocketOpen(profileClient)) {
      return { client: profileClient, helmKey };
    }
    return null;
  }

  function getState(): HelmUpdateState | null {
    const helmKey = resolveHelmKey();
    const existing = input.inventory.helmInventories[helmKey]?.update;
    const intent = readHelmUpdateIntent(helmKey);
    if (existing || !intent) return existing ?? null;
    return {
      status: "restarting",
      currentVersion: "未知",
      latestVersion: intent.targetVersion,
      updateAvailable: true,
      canUpdate: true,
      targetVersion: intent.targetVersion,
      message: "等待 Helm 重启并确认新版本。",
    };
  }

  async function refresh() {
    const target = resolveTarget();
    if (!target) return;
    try {
      await input.dispatch(target.client, "daemon/update/check", { force: true });
    } catch (error) {
      const previous = input.inventory.helmInventories[target.helmKey]?.update;
      input.inventory.applyHelmInventory(target.helmKey, {
        update: {
          ...(previous ?? {
            currentVersion: "未知",
            updateAvailable: false,
            canUpdate: false,
          }),
          status: "failed",
          checkStatus: "failed",
          manualCommand: previous?.manualCommand ?? MANUAL_UPDATE_COMMAND,
          message: input.formatError(error),
        },
      });
    }
  }

  async function start() {
    const target = resolveTarget();
    if (!target) return;
    const previous = input.inventory.helmInventories[target.helmKey]?.update;
    const targetVersion = previous?.latestVersion;
    if (targetVersion && previous?.updateAvailable && previous.canUpdate) {
      writeHelmUpdateIntent(target.helmKey, targetVersion);
      input.inventory.applyHelmInventory(target.helmKey, {
        update: {
          ...previous,
          status: "restarting",
          targetVersion,
          updateAvailable: false,
          message: "正在启动 Helm 更新。",
        },
      });
    }
    try {
      await input.dispatch(target.client, "daemon/update/start", {});
    } catch (error) {
      clearHelmUpdateIntent(target.helmKey);
      const current = input.inventory.helmInventories[target.helmKey]?.update;
      input.inventory.applyHelmInventory(target.helmKey, {
        update: {
          ...(current ?? {
            currentVersion: "未知",
            updateAvailable: false,
            canUpdate: false,
          }),
          status: "failed",
          manualCommand: current?.manualCommand ?? MANUAL_UPDATE_COMMAND,
          message: input.formatError(error),
        },
      });
    }
  }

  return {
    getState,
    resolveHelmKey,
    resolveTarget,
    refresh,
    start,
  };
}

function isSocketOpen(client: DeckRpcClient) {
  return client.socket.readyState === 1;
}
