type AcpSessionResponseWithModels = {
  sessionId?: string;
  session_id?: string;
  id?: string;
};

type AcpSetSessionModelRequest = {
  sessionId: string;
  modelId: string;
};

export function resolveRuntimeSessionId(sessionResult: unknown, fallbackSessionId: string) {
  const result = sessionResult && typeof sessionResult === "object" ? sessionResult as AcpSessionResponseWithModels : null;
  return result?.sessionId ?? result?.session_id ?? result?.id ?? fallbackSessionId;
}

export function buildSessionNewRequest(id: string, cwd: string, agent?: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/new",
    params: {
      cwd,
      mcpServers: [],
      ...(agent ? { agent } : {}),
    },
  };
}

export function buildSessionLoadRequest(id: string, sessionId: string, cwd: string, agent?: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/load",
    params: {
      sessionId,
      cwd,
      mcpServers: [],
      ...(agent ? { agent } : {}),
    },
  };
}

export function buildSessionResumeRequest(id: string, sessionId: string, cwd: string, agent?: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/resume",
    params: {
      sessionId,
      cwd,
      mcpServers: [],
      ...(agent ? { agent } : {}),
    },
  };
}

export function buildSessionPromptRequest(id: string, sessionId: string, text: string, agent?: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/prompt",
    params: {
      sessionId,
      prompt: [{ type: "text", text }],
      ...(agent ? { agent } : {}),
    },
  };
}


export function buildSessionCloseRequest(id: string, sessionId: string, agent?: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/close",
    params: {
      sessionId,
      ...(agent ? { agent } : {}),
    },
  };
}

export function buildSessionDeleteRequest(id: string, sessionId: string, agent?: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/delete",
    params: {
      sessionId,
      ...(agent ? { agent } : {}),
    },
  };
}

export function buildSessionSetModelRequest(id: string, sessionId: string, modelId: string) {
  return {
    jsonrpc: "2.0",
    id,
    method: "session/set_model",
    params: {
      sessionId,
      modelId,
    } satisfies AcpSetSessionModelRequest,
  };
}