import { createTrustedDeviceStore } from "../auth/beacon-store";
import { createHelmSessionStores } from "../sessions/facade";
import type { HelmServerEnvironment } from "./server-environment";

type CreateHelmServerStoresOptions = {
  environment: HelmServerEnvironment;
  logInfo: (message: string) => void;
  logError: (message: string) => void;
};

export function createHelmServerStores(options: CreateHelmServerStoresOptions) {
  const { environment, logInfo, logError } = options;
  const sessionStores = createHelmSessionStores({
    sqlitePath: environment.sessionsSqlitePath,
    attachmentRootPath: environment.sessionAttachmentsPath,
    jsonPaths: {
      sessionHistoryPath: environment.sessionHistoryPath,
      sessionMessagesPath: environment.sessionMessagesPath,
      sessionArtifactsPath: environment.sessionArtifactsPath,
      sessionRuntimesPath: environment.sessionRuntimesPath,
    },
    logInfo,
    logError,
  });

  return {
    ...sessionStores,
    trustedDeviceStore: createTrustedDeviceStore(environment.trustedDevicesPath),
  };
}
