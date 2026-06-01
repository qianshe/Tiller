import assert from "node:assert/strict";
import test from "node:test";
import { createSessionPersistenceService } from "./session-persistence-service";

test("deleteLocalSessionData removes timeline entries with other local session stores", () => {
  const removed: string[] = [];
  const sessionId = "session-1";

  const service = createSessionPersistenceService({
    sessionStore: { remove: (id) => removed.push(`session:${id}`) },
    sessionMessageStore: {
      append: () => undefined,
      remove: (id) => removed.push(`messages:${id}`),
    },
    sessionArtifactStore: { remove: (id) => removed.push(`artifacts:${id}`) },
    sessionAttachmentStore: { removeSession: (id) => removed.push(`attachments:${id}`) },
    sessionRuntimeStore: { remove: (id) => removed.push(`runtime:${id}`) },
    sessionTimelineStore: { remove: (id) => removed.push(`timeline:${id}`) },
  });

  service.deleteLocalSessionData(sessionId);

  assert.deepEqual(removed, [
    `session:${sessionId}`,
    `messages:${sessionId}`,
    `artifacts:${sessionId}`,
    `attachments:${sessionId}`,
    `runtime:${sessionId}`,
    `timeline:${sessionId}`,
  ]);
});
