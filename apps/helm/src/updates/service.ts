import type { TillerConfig } from "@tiller/agent-registry";
import { buildLatestUpdateCommand } from "./installer.js";
import {
  createUpdateCheckService,
  LATEST_UPDATE_COMMAND,
  resolveUpdateOptions,
  type UpdateCheckResult,
  type UpdateVersions,
} from "./check.js";
import {
  appendUpdateLog,
  spawnOneShotUpdater,
  type OneShotUpdaterLaunch,
} from "./updater-runtime.js";

export type UpdateStatus = "checking" | "available" | "installing" | "restarting" | "up-to-date" | "failed" | "unsupported";
export type UpdateStatusEvent = {
  status: UpdateStatus;
  currentVersion: string;
  canUpdate: boolean;
  latestVersion?: string;
  targetVersion?: string;
  checkStatus?: UpdateCheckResult["checkStatus"];
  cannotUpdateReason?: string;
  manualCommand?: string;
  checkedAt?: string;
  message?: string;
};
export type UpdateService = ReturnType<typeof createUpdateService>;
export type UpdateServiceErrorKind = "check-failed" | "not-supported" | "in-progress" | "start-failed";

export class UpdateServiceError extends Error {
  constructor(
    public readonly kind: UpdateServiceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "UpdateServiceError";
  }
}

export function createUpdateService(options: {
  currentVersion: string;
  config?: Pick<TillerConfig, "updates">;
  env?: NodeJS.ProcessEnv;
  host: string;
  port: number;
  isPublishedRuntime: boolean;
  logPath: string;
  updaterLaunch?: OneShotUpdaterLaunch;
  emitStatus: (status: UpdateStatusEvent) => void;
  loadVersions?: (current: string, force?: boolean) => Promise<UpdateVersions>;
  requestShutdown: (reason: "rpc") => void;
  spawnUpdater?: (launch: OneShotUpdaterLaunch) => import("node:child_process").ChildProcess;
}) {
  const updateOptions = resolveUpdateOptions({ env: options.env, config: options.config });
  const checker = createUpdateCheckService({
    currentVersion: options.currentVersion,
    canUpdate: true,
    manualCommand: LATEST_UPDATE_COMMAND,
    loadVersions: options.loadVersions,
  });
  const spawnUpdater = options.spawnUpdater ?? ((launch: OneShotUpdaterLaunch) => {
    return spawnOneShotUpdater(launch);
  });
  let inProgress = false;
  let activeUpdater: import("node:child_process").ChildProcess | undefined;

  async function check(
    force = false,
    connectionIsLocal = true,
    emitStatus: (status: UpdateStatusEvent) => void = options.emitStatus,
  ): Promise<UpdateCheckResult> {
    const cannotUpdateReason = resolveCannotUpdateReason(options.isPublishedRuntime, connectionIsLocal);
    const canUpdate = options.isPublishedRuntime && connectionIsLocal;
    if (!force && !updateOptions.checkOnStart) {
      return {
        currentVersion: options.currentVersion,
        updateAvailable: false,
        canUpdate,
        checkStatus: "disabled",
        cannotUpdateReason,
        manualCommand: LATEST_UPDATE_COMMAND,
      };
    }
    emitStatus({
      status: "checking",
      currentVersion: options.currentVersion,
      canUpdate,
      cannotUpdateReason,
      manualCommand: LATEST_UPDATE_COMMAND,
    });
    try {
      const rawResult = await checker.check(force);
      const result = {
        ...rawResult,
        canUpdate,
        checkStatus: options.isPublishedRuntime ? rawResult.checkStatus : "unsupported" as const,
        cannotUpdateReason,
      };
      const status = result.checkStatus === "unsupported"
        ? "unsupported"
        : result.checkStatus === "failed"
          ? "failed"
          : result.updateAvailable
            ? "available"
            : "up-to-date";
      emitStatus({
        status,
        currentVersion: result.currentVersion,
        canUpdate: result.canUpdate,
        latestVersion: result.latestVersion,
        checkStatus: result.checkStatus,
        cannotUpdateReason: result.cannotUpdateReason,
        manualCommand: result.manualCommand,
        checkedAt: result.checkedAt,
      });
      return result;
    } catch (error) {
      const rawResult = (error as { result?: UpdateCheckResult }).result;
      const result = rawResult
        ? {
            ...rawResult,
            canUpdate,
            checkStatus: options.isPublishedRuntime ? rawResult.checkStatus : "unsupported" as const,
            cannotUpdateReason,
          }
        : undefined;
      emitStatus({
        status: "failed",
        currentVersion: options.currentVersion,
        canUpdate,
        cannotUpdateReason,
        manualCommand: LATEST_UPDATE_COMMAND,
        checkStatus: result?.checkStatus ?? "failed",
        message: error instanceof Error ? error.message : String(error),
      });
      if (result) return result;
      throw new UpdateServiceError(
        "check-failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function start(
    connectionIsLocal = true,
    emitStatus: (status: UpdateStatusEvent) => void = options.emitStatus,
  ) {
    if (inProgress) {
      throw new UpdateServiceError("in-progress", "Helm update is already in progress.");
    }
    if (!options.isPublishedRuntime || !connectionIsLocal) {
      throw new UpdateServiceError(
        "not-supported",
        resolveCannotUpdateReason(options.isPublishedRuntime, connectionIsLocal) ?? "Helm cannot be updated automatically.",
      );
    }
    if (!options.updaterLaunch) {
      throw new UpdateServiceError("not-supported", "Published updater is unavailable.");
    }
    inProgress = true;
    try {
      const result = await check(true, connectionIsLocal, emitStatus);
      if (!result.canUpdate) {
        throw new UpdateServiceError(
          "not-supported",
          result.cannotUpdateReason ?? "Helm cannot be updated automatically.",
        );
      }
      if (result.checkStatus === "failed") {
        throw new UpdateServiceError("check-failed", "无法确认 npm latest 版本，未执行更新。");
      }
      if (!result.updateAvailable || !result.latestVersion) {
        emitStatus({
          status: "up-to-date",
          currentVersion: result.currentVersion,
          canUpdate: result.canUpdate,
          latestVersion: result.latestVersion,
          checkStatus: result.checkStatus,
          cannotUpdateReason: result.cannotUpdateReason,
          manualCommand: result.manualCommand,
          checkedAt: result.checkedAt,
        });
        return {
          status: "up-to-date" as const,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          message: "Helm 已是最新版本。",
        };
      }

      emitStatus({
        status: "installing",
        currentVersion: result.currentVersion,
        canUpdate: result.canUpdate,
        latestVersion: result.latestVersion,
        targetVersion: result.latestVersion,
        checkStatus: result.checkStatus,
        cannotUpdateReason: result.cannotUpdateReason,
        manualCommand: result.manualCommand,
        checkedAt: result.checkedAt,
      });
      // The updater owns npm, waiting for the old PID, and launching the replacement.
      // Starting it before shutdown keeps the old process alive until the handoff is safe.
      const updater = spawnUpdater({
        ...options.updaterLaunch,
        targetVersion: result.latestVersion,
        currentVersion: result.currentVersion,
      });
      activeUpdater = updater;
      let updaterFailureHandled = false;
      const handleUpdaterFailure = (message: string) => {
        if (updaterFailureHandled || activeUpdater !== updater) return;
        updaterFailureHandled = true;
        activeUpdater = undefined;
        inProgress = false;
        appendUpdateLog(options.logPath, message);
        emitStatus({
          status: "failed",
          currentVersion: options.currentVersion,
          canUpdate: result.canUpdate,
          latestVersion: result.latestVersion,
          targetVersion: result.latestVersion,
          manualCommand: LATEST_UPDATE_COMMAND,
          message,
        });
      };
      updater.on("message", (message: unknown) => {
        if (!message || typeof message !== "object") return;
        const updateMessage = message as {
          kind?: string;
          status?: UpdateStatus;
          message?: string;
        };
        if (updateMessage.kind === "shutdown") {
          options.requestShutdown("rpc");
          return;
        }
        if (updateMessage.kind === "status" && updateMessage.status) {
          emitStatus({
            status: updateMessage.status,
            currentVersion: result.currentVersion,
            canUpdate: result.canUpdate,
            latestVersion: result.latestVersion,
            targetVersion: updateMessage.status === "up-to-date"
              ? undefined
              : result.latestVersion,
            checkStatus: result.checkStatus,
            cannotUpdateReason: result.cannotUpdateReason,
            manualCommand: result.manualCommand,
            checkedAt: result.checkedAt,
            message: updateMessage.message,
          });
        }
      });
      updater.once("error", (error) => {
        handleUpdaterFailure(error.message);
      });
      updater.once("exit", (code) => {
        if (code !== 0) {
          const message = `Updater exited with code ${code ?? 1}.`;
          handleUpdaterFailure(message);
        } else {
          if (activeUpdater !== updater) return;
          activeUpdater = undefined;
          inProgress = false;
        }
      });
      return {
        status: "restarting" as const,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        message: "Helm 正在安装更新并重启。",
      };
    } catch (error) {
      appendUpdateLog(options.logPath, error instanceof Error ? error.message : String(error));
      emitStatus({
        status: "failed",
        currentVersion: options.currentVersion,
        canUpdate: options.isPublishedRuntime && connectionIsLocal,
        manualCommand: LATEST_UPDATE_COMMAND,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof UpdateServiceError) throw error;
      throw new UpdateServiceError(
        "start-failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (!activeUpdater) {
        inProgress = false;
      }
    }
  }

  return {
    check,
    start,
    canUpdate: options.isPublishedRuntime,
    manualCommand: LATEST_UPDATE_COMMAND,
    buildLatestUpdateCommand,
  };
}

function resolveCannotUpdateReason(isPublishedRuntime: boolean, connectionIsLocal: boolean) {
  if (!isPublishedRuntime) return "当前 Helm 不是发布包运行实例";
  if (!connectionIsLocal) return "远程 Helm 不支持自动更新";
  return undefined;
}
