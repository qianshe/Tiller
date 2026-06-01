import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createHelmServerEnvironment } from "./server-environment";

test("createHelmServerEnvironment derives data paths next to the config file", () => {
  const configPath = resolve("/tmp/tiller/config.json");
  const environment = createHelmServerEnvironment(configPath);

  assert.equal(environment.configPath, configPath);
  assert.equal(environment.logsDir, resolve("/tmp/tiller/logs"));
  assert.equal(environment.sessionHistoryPath, resolve("/tmp/tiller/sessions.json"));
  assert.equal(environment.sessionMessagesPath, resolve("/tmp/tiller/session-messages"));
  assert.equal(environment.sessionArtifactsPath, resolve("/tmp/tiller/session-artifacts"));
  assert.equal(environment.sessionAttachmentsPath, resolve("/tmp/tiller/session-attachments"));
  assert.equal(environment.sessionTimelineBlocksPath, resolve("/tmp/tiller/timeline-blocks"));
  assert.equal(environment.sessionRuntimesPath, resolve("/tmp/tiller/session-runtimes.json"));
  assert.equal(environment.sessionsSqlitePath, resolve("/tmp/tiller/sessions.sqlite"));
  assert.equal(environment.trustedDevicesPath, resolve("/tmp/tiller/trusted-devices.json"));
});
