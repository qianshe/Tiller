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
    sessionStore: { list: () => [] } as never,
    sessionMessageStore: {} as never,
    sessionArtifactStore: {} as never,
    sessionAttachmentStore: {} as never,
    sessionOutputBodyStore: {} as never,
    sessionDiffBodyStore: {} as never,
    sessionRuntimeStore: {} as never,
    sessionPlanStore: {} as never,
    sessionTimelineStore: {} as never,
    sessionUpdateStore: {} as never,
    sessionStateStore: {} as never,
    sessionApprovalStore: {} as never,
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

test("session restore never rewrites an existing canonical timeline", () => {
  const source = readFileSync(resolve(currentDir, "resume-service.ts"), "utf8");

  assert.doesNotMatch(source, /repairCompactionBootstrapTimeline/u);
  assert.doesNotMatch(source, /sessionTimelineStore\?\.replace/u);
  assert.doesNotMatch(source, /sessionTimelineStore\.replace/u);
});

test("reimport no longer patches plan, messages, or tool calls from transcript or local repair paths", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.doesNotMatch(source, /readAdapterTranscriptPlanRepair\(/u);
  assert.doesNotMatch(source, /appendTranscriptRepairPlanUpdate\(/u);
  assert.doesNotMatch(source, /applyLocalMessageRepair\(/u);
  assert.doesNotMatch(source, /readAdapterTranscriptMessageRepair\(/u);
  assert.doesNotMatch(source, /applyTranscriptMessageRepair\(/u);
  assert.doesNotMatch(source, /readAdapterTranscriptToolCallRepair\(/u);
  assert.doesNotMatch(source, /applyTranscriptToolCallRepair\(/u);
});

test("reimport no longer merges prompts or sanitizes recovered ordering after ACP replay", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.doesNotMatch(source, /preservePreviousUserPromptsAfterReimport\(/u);
  assert.doesNotMatch(source, /recoverUserPromptFromSessionSummary\(/u);
  assert.doesNotMatch(source, /sanitizeRecoveredHistoryOrdering\(/u);
});

test("startSessionResume delegates directly to the resume service without transcript repair", () => {
  const source = readFileSync(resolve(currentDir, "service-factory.ts"), "utf8");

  assert.match(
    source,
    /async function startSessionResume\([\s\S]*const result = await sessionResume\.startSessionResume\(sessionId, resumeOptions\);[\s\S]*ensureLiveEventSequenceForSession\(sessionId, options\.createHandlerContext\(\)\);[\s\S]*return result;/u,
  );
  assert.doesNotMatch(source, /async function startSessionResume\([\s\S]*applyTranscriptToolCallRepair\(/u);
});
