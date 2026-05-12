export type SessionTopicRegistry = ReturnType<typeof createSessionTopicRegistry>;

export function createSessionTopicRegistry() {
  const socketToSessions = new Map<string, Set<string>>();
  const sessionToSockets = new Map<string, Set<string>>();

  function subscribe(socketId: string, sessionId: string): void {
    let sessions = socketToSessions.get(socketId);
    if (!sessions) {
      sessions = new Set<string>();
      socketToSessions.set(socketId, sessions);
    }
    sessions.add(sessionId);

    let sockets = sessionToSockets.get(sessionId);
    if (!sockets) {
      sockets = new Set<string>();
      sessionToSockets.set(sessionId, sockets);
    }
    sockets.add(socketId);
  }

  function unsubscribe(socketId: string, sessionId: string): void {
    const sessions = socketToSessions.get(socketId);
    sessions?.delete(sessionId);
    if (sessions?.size === 0) {
      socketToSessions.delete(socketId);
    }

    const sockets = sessionToSockets.get(sessionId);
    sockets?.delete(socketId);
    if (sockets?.size === 0) {
      sessionToSockets.delete(sessionId);
    }
  }

  function removeSocket(socketId: string): void {
    for (const sessionId of socketToSessions.get(socketId) ?? []) {
      const sockets = sessionToSockets.get(sessionId);
      sockets?.delete(socketId);
      if (sockets?.size === 0) {
        sessionToSockets.delete(sessionId);
      }
    }
    socketToSessions.delete(socketId);
  }

  function listSubscribers(sessionId: string): string[] {
    return Array.from(sessionToSockets.get(sessionId) ?? []);
  }

  function listSubscriptions(socketId: string): string[] {
    return Array.from(socketToSessions.get(socketId) ?? []);
  }

  return {
    subscribe,
    unsubscribe,
    removeSocket,
    listSubscribers,
    listSubscriptions,
  };
}
