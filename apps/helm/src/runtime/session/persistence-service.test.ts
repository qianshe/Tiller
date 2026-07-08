import assert from "node:assert/strict";
import test from "node:test";
import { createSessionPersistenceService } from "./persistence-service";

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
    sessionOutputBodyStore: { removeSession: (id) => removed.push(`output-bodies:${id}`) },
    sessionAttachmentStore: { removeSession: (id) => removed.push(`attachments:${id}`) },
    sessionRuntimeStore: { remove: (id) => removed.push(`runtime:${id}`) },
    sessionPlanStore: { remove: (id) => removed.push(`plans:${id}`) },
    sessionTimelineStore: { remove: (id) => removed.push(`timeline:${id}`) },
    sessionUpdateStore: { remove: (id) => removed.push(`updates:${id}`) },
  });

  service.deleteLocalSessionData(sessionId);

  assert.deepEqual(removed, [
    `session:${sessionId}`,
    `messages:${sessionId}`,
    `artifacts:${sessionId}`,
    `output-bodies:${sessionId}`,
    `attachments:${sessionId}`,
    `runtime:${sessionId}`,
    `plans:${sessionId}`,
    `timeline:${sessionId}`,
    `updates:${sessionId}`,
  ]);
});
