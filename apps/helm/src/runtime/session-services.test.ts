import assert from "node:assert/strict";
import test from "node:test";
import { createSessionServices } from "./session-services";

test("createSessionServices exposes the runtime service graph without starting providers", () => {
  const services = createSessionServices({
    sessions: new Map(),
    permissionIndex: new Map(),
    sessionStore: {} as never,
    sessionMessageStore: {} as never,
    sessionArtifactStore: {} as never,
    sessionRuntimeStore: {} as never,
    getAgents: () => [],
    getProjects: () => [],
    getWorktrees: () => [],
    createHandlerContext: () => ({}) as never,
    broadcastNotification: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  });

  assert.equal(typeof services.buildResumeInfo, "function");
  assert.equal(typeof services.createRuntimeDraft, "function");
  assert.equal(typeof services.discardRuntimeDraft, "function");
  assert.equal(typeof services.handleRuntimeEvent, "function");
  assert.equal(typeof services.startSessionResume, "function");
  assert.equal(typeof services.updateSessionSummary, "function");
});
