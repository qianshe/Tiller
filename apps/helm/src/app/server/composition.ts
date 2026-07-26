import { createTrustedDeviceStore } from "../../auth/beacon-store";
import { createHelmSessionStores } from "../../sessions/facade";
import { normalizeOrphanedActiveSessions } from "../../sessions/startup-normalize";
import type { HelmServerEnvironment } from "./environment";

type CreateHelmServerStoresOptions = {
  environment: HelmServerEnvironment;
  logDebug: (message: string) => void;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

export function createHelmServerStores(options: CreateHelmServerStoresOptions) {
  const { environment, logDebug, logInfo, logError } = options;
  const sessionStores = createHelmSessionStores({
    sqlitePath: environment.sessionsSqlitePath,
    attachmentRootPath: environment.sessionAttachmentsPath,
    outputBodyRootPath: environment.sessionOutputBodiesPath,
    timelineBlockRootPath: environment.sessionTimelineBlocksPath,
    timelineBlockMode: process.env.TILLER_TIMELINE_BLOCK_MODE,
    jsonPaths: {
      sessionHistoryPath: environment.sessionHistoryPath,
      sessionMessagesPath: environment.sessionMessagesPath,
      sessionArtifactsPath: environment.sessionArtifactsPath,
      sessionRuntimesPath: environment.sessionRuntimesPath,
    },
    logDebug,
    logInfo,
    logError,
  });

  // 启动阶段尚无活跃 runtime,持久化里仍是活跃状态的会话都是上次进程留下的孤儿。
  const interruptedSessionIds = normalizeOrphanedActiveSessions(sessionStores.sessionStore);
  if (interruptedSessionIds.length > 0) {
    logInfo(
      `[tiller] session.store normalized ${interruptedSessionIds.length} interrupted session(s): ${interruptedSessionIds.join(", ")}`,
    );
  }

  return {
    ...sessionStores,
    trustedDeviceStore: createTrustedDeviceStore(environment.trustedDevicesPath),
  };
}
