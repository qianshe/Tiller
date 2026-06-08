import { createTrustedDeviceStore } from "../../auth/beacon-store";
import { createHelmSessionStores } from "../../sessions/facade";
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

  return {
    ...sessionStores,
    trustedDeviceStore: createTrustedDeviceStore(environment.trustedDevicesPath),
  };
}
