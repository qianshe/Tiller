import assert from "node:assert/strict";
import test from "node:test";
import { createHandlerSessionContextFactory } from "./handler-session-context";

test("handler session context groups runtime dependencies and preserves queue drain context", async () => {
  const calls: unknown[] = [];
  const sessions = new Map();
  const permissionIndex = new Map();
  const factory = createHandlerSessionContextFactory({
    sessions,
    permissionIndex,
    sessionStore: { id: "sessionStore" },
    sessionMessageStore: { id: "sessionMessageStore" },
    sessionArtifactStore: { id: "sessionArtifactStore" },
    sessionRuntimeStore: { id: "sessionRuntimeStore" },
    liveMessageBuffer: { id: "liveMessageBuffer" },
    promptQueue: { id: "promptQueue" },
    createHandlerContext: (socketId) => ({ socketId }),
    drainPromptQueue: async (sessionId, context) => {
      calls.push({ sessionId, context });
    },
    createRuntime: () => undefined,
    connectAcpConnection: () => undefined,
    reconnectAcpConnection: () => undefined,
    listAcpConnectionInventory: () => [],
    createRuntimeDraft: async () => ({ ok: true }),
    discardRuntimeDraft: async () => ({ ok: true }),
    discardRuntimeDraftsForDeckClient: async () => undefined,
    scheduleDeckClientDraftDiscard: () => undefined,
    takeRuntimeDraft: () => undefined,
    configureRuntimeDraft: async () => ({ ok: true }),
    testAcpConnection: async () => ({ ok: true, message: "ok" }),
    resolveHelmById: () => undefined,
    resolveProjectById: () => undefined,
    resolveProviderById: () => undefined,
    startSessionResume: async () => ({ ok: true }),
    handleRuntimeEvent: () => undefined,
    hydrateSessionSummary: (summary) => summary,
    migrateStoredSessionSummary: (summary) => summary,
    buildResumeInfo: () => ({}),
    persistRuntimeDescriptor: () => undefined,
    refreshAuthoritativeSessionHistory: async () => undefined,
    updateSessionSummary: () => undefined,
    persistSessionMessage: () => undefined,
    publishDiffUpdate: async () => undefined,
    reimportSessionHistory: async () => ({}),
    hydrateDiffsFromWorktreeGit: async (_sessionId, files) => files,
    clearPermissionRequestsForSession: () => undefined,
    deleteLocalSessionData: () => undefined,
  });

  const context = factory.forSocket("socket-a");
  await context.drainPromptQueue("session-1");

  assert.equal(context.sessions, sessions);
  assert.equal(context.permissionIndex, permissionIndex);
  assert.equal(context.approvalIndex, permissionIndex);
  assert.deepEqual(calls, [{ sessionId: "session-1", context: { socketId: "socket-a" } }]);
});
