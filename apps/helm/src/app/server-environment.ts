import { dirname, resolve } from "node:path";

export type HelmServerEnvironment = {
  configPath: string;
  logsDir: string;
  sessionHistoryPath: string;
  sessionMessagesPath: string;
  sessionArtifactsPath: string;
  sessionRuntimesPath: string;
  sessionsSqlitePath: string;
  trustedDevicesPath: string;
};

export function createHelmServerEnvironment(configPath: string): HelmServerEnvironment {
  const configDir = dirname(configPath);
  return {
    configPath,
    logsDir: resolve(configDir, "logs"),
    sessionHistoryPath: resolve(configDir, "sessions.json"),
    sessionMessagesPath: resolve(configDir, "session-messages"),
    sessionArtifactsPath: resolve(configDir, "session-artifacts"),
    sessionRuntimesPath: resolve(configDir, "session-runtimes.json"),
    sessionsSqlitePath: resolve(configDir, "sessions.sqlite"),
    trustedDevicesPath: resolve(configDir, "trusted-devices.json"),
  };
}
