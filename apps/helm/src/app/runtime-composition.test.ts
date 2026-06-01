import assert from "node:assert/strict";
import test from "node:test";
import type { PermissionRequest } from "@tiller/shared";
import type { HelmHandlerContext } from "../handlers/context";
import type { SessionServicesOptions } from "../runtime/session-services";
import { createHelmRuntimeComposition } from "./runtime-composition";

function createSessionStore(): SessionServicesOptions["sessionStore"] {
  return {
    list: () => [],
    upsert: () => [],
    remove: () => [],
  };
}

function createSessionMessageStore(): SessionServicesOptions["sessionMessageStore"] {
  return {
    append: () => [],
    replace: () => [],
    list: () => [],
    listPage: () => ({ messages: [], hasMore: false }),
    remove: () => undefined,
  };
}

function createSessionArtifactStore(): SessionServicesOptions["sessionArtifactStore"] {
  return {
    appendOutput: () => ({ outputs: [], diffs: [], toolCalls: [] }),
    replaceDiffs: () => ({ outputs: [], diffs: [], toolCalls: [] }),
    appendToolCall: () => ({ outputs: [], diffs: [], toolCalls: [] }),
    replaceToolCalls: () => ({ outputs: [], diffs: [], toolCalls: [] }),
    get: () => ({ outputs: [], diffs: [], toolCalls: [] }),
    getPage: () => ({ outputs: [], diffs: [], toolCalls: [], hasMore: false }),
    remove: () => undefined,
  };
}

function createSessionAttachmentStore(): SessionServicesOptions["sessionAttachmentStore"] {
  return {
    put: () => ({
      id: "attachment-1",
      sessionId: "session-1",
      mimeType: "image/png",
      sha256: "sha256",
      byteSize: 0,
      storageKey: "storage-key",
      uri: "/api/sessions/session-1/attachments/attachment-1",
      createdAt: new Date(0).toISOString(),
    }),
    get: () => undefined,
    listForMessage: () => [],
    readBytes: () => undefined,
    removeSession: () => undefined,
  };
}

function createSessionRuntimeStore(): SessionServicesOptions["sessionRuntimeStore"] {
  return {
    list: () => [],
    get: () => null,
    upsert: (descriptor) => descriptor,
    remove: () => undefined,
  };
}

function createSessionTimelineStore(): SessionServicesOptions["sessionTimelineStore"] {
  return {
    append: () => [],
    replace: () => [],
    list: () => [],
    listPage: () => ({ entries: [], hasMore: false }),
    remove: () => undefined,
  };
}

test("createHelmRuntimeComposition owns runtime maps queue and services", () => {
  const composition = createHelmRuntimeComposition({
    sessionStore: createSessionStore(),
    sessionMessageStore: createSessionMessageStore(),
    sessionArtifactStore: createSessionArtifactStore(),
    sessionAttachmentStore: createSessionAttachmentStore(),
    sessionRuntimeStore: createSessionRuntimeStore(),
    sessionTimelineStore: createSessionTimelineStore(),
    getAgents: () => [],
    getProjects: () => [],
    getWorktrees: () => [],
    createHandlerContext: () => ({}) as HelmHandlerContext,
    broadcastNotification: () => undefined,
    logInfo: () => undefined,
    logError: () => undefined,
  });

  assert.equal(composition.sessions instanceof Map, true);
  assert.equal(composition.permissionIndex instanceof Map, true);
  assert.equal(typeof composition.promptQueue.enqueue, "function");
  assert.equal(typeof composition.sessionServices.hydrateSessionSummary, "function");

  composition.permissionIndex.set("request-1", {
    sessionId: "session-1",
    request: { id: "request-1" } as PermissionRequest,
  });
  composition.sessionServices.clearPermissionRequestsForSession("session-1");
  assert.equal(composition.permissionIndex.has("request-1"), false);

  composition.promptQueue.enqueue({
    sessionId: "session-1",
    text: "hello",
    clientMessageId: "client-message-1",
  });
  assert.equal(composition.promptQueue.snapshot("session-1").queued.length, 1);
});
