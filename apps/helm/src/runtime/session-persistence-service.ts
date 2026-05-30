import type { AgentMessage } from "@tiller/shared";

type SessionPersistenceServiceOptions = {
  sessionStore: { remove(sessionId: string): void };
  sessionMessageStore: {
    append(sessionId: string, message: AgentMessage): void;
    remove(sessionId: string): void;
  };
  sessionArtifactStore: { remove(sessionId: string): void };
  sessionRuntimeStore: { remove(sessionId: string): void };
  sessionTimelineStore: { remove(sessionId: string): void };
};

export function createSessionPersistenceService(options: SessionPersistenceServiceOptions) {
  function deleteLocalSessionData(sessionId: string) {
    options.sessionStore.remove(sessionId);
    options.sessionMessageStore.remove(sessionId);
    options.sessionArtifactStore.remove(sessionId);
    options.sessionRuntimeStore.remove(sessionId);
    options.sessionTimelineStore.remove(sessionId);
  }

  function persistSessionMessage(sessionId: string, message: AgentMessage) {
    options.sessionMessageStore.append(sessionId, message);
  }

  return {
    deleteLocalSessionData,
    persistSessionMessage,
  };
}
