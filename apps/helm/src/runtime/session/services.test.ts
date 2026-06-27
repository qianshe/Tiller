import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSessionServices } from "./services";

const currentDir = dirname(fileURLToPath(import.meta.url));

test("createSessionServices exposes the runtime service graph without starting providers", () => {
  const services = createSessionServices({
    sessions: new Map(),
    permissionIndex: new Map(),
    sessionStore: {} as never,
    sessionMessageStore: {} as never,
    sessionArtifactStore: {} as never,
    sessionAttachmentStore: {} as never,
    sessionRuntimeStore: {} as never,
    sessionTimelineStore: {} as never,
    sessionUpdateStore: {} as never,
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

test("reimport success keeps ACP load replay as the history source", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.doesNotMatch(source, /loadAdapterAuthoritativeHistory/u);
  assert.doesNotMatch(source, /importAuthoritativeProviderHistory\(/u);
  assert.doesNotMatch(
    source,
    /else\s*\{[\s\S]*importAuthoritativeProviderHistory\(/u,
  );
});

test("reimport failure restores the previous session plan", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.match(source, /const previousPlan = providerHistory\.readSessionPlan\(sessionId\);/u);
  assert.match(
    source,
    /restorePreviousLocalHistory[\s\S]*providerHistory\.recordSessionPlan\(sessionId, previousPlan\);/u,
  );
});

test("reimport resets replay timeline and restores it on failure", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.match(source, /const previousTimeline = options\.sessionTimelineStore\.list\(sessionId\);/u);
  assert.match(
    source,
    /restorePreviousLocalHistory[\s\S]*previousTimeline\.length[\s\S]*options\.sessionTimelineStore\.replace\(sessionId, previousTimeline\);/u,
  );
  assert.match(
    source,
    /options\.sessionArtifactStore\.remove\(sessionId\);\s*options\.sessionTimelineStore\.remove\(sessionId\);\s*providerHistory\.resetRefresh\(sessionId\);/u,
  );
});

test("reimport can repair missing plans through the provider adapter", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.match(
    source,
    /if \(!plan\) \{[\s\S]*readAdapterTranscriptPlanRepair\(\{[\s\S]*summary: recoverySummary/u,
  );
  assert.match(
    source,
    /appendTranscriptRepairPlanUpdate\(\{[\s\S]*sessionUpdateStore: options\.sessionUpdateStore/u,
  );
});
