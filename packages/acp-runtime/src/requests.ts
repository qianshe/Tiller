type AcpSessionResponseWithModels = {
  sessionId?: string;
  session_id?: string;
  id?: string;
};

export function resolveRuntimeSessionId(sessionResult: unknown, fallbackSessionId: string) {
  const result = sessionResult && typeof sessionResult === "object" ? sessionResult as AcpSessionResponseWithModels : null;
  return result?.sessionId ?? result?.session_id ?? result?.id ?? fallbackSessionId;
}
