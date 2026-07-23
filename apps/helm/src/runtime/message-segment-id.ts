export type MessageSegmentIdInput = {
  text: string;
  providerMessageId?: string | null;
};

export function createMessageSegmentIdAllocator() {
  const turns = new Map<string, number>();
  const segments = new Map<string, number>();

  function ensureTurn(sessionId: string) {
    if (!turns.has(sessionId)) {
      turns.set(sessionId, 1);
      segments.set(sessionId, 0);
    }
  }

  function startAssistantTurn(sessionId: string) {
    turns.set(sessionId, (turns.get(sessionId) ?? 0) + 1);
    segments.set(sessionId, 0);
  }

  function bumpToolBoundary(sessionId: string) {
    ensureTurn(sessionId);
    segments.set(sessionId, (segments.get(sessionId) ?? 0) + 1);
  }

  function nextAssistantSegmentId(sessionId: string, input: MessageSegmentIdInput) {
    ensureTurn(sessionId);
    const turn = turns.get(sessionId) ?? 1;
    const segment = segments.get(sessionId) ?? 0;
    return `${sessionId}-msg-${padSequence(turn)}-${padSequence(segment)}-${identitySuffix(input)}`;
  }

  function removeSession(sessionId: string) {
    turns.delete(sessionId);
    segments.delete(sessionId);
  }

  return { startAssistantTurn, bumpToolBoundary, nextAssistantSegmentId, removeSession };
}

function identitySuffix(input: MessageSegmentIdInput) {
  const provider = sanitizeProviderId(input.providerMessageId);
  if (provider) {
    return `p${provider}`;
  }
  return `c${stableHash(normalizeTextForFingerprint(input.text))}`;
}

function sanitizeProviderId(value: string | null | undefined) {
  const normalized = value?.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return normalized ? normalized.slice(0, 16) : null;
}

function normalizeTextForFingerprint(value: string) {
  return value.replace(/\s+/gu, " ").trim().slice(0, 160);
}

function padSequence(value: number) {
  return String(value).padStart(6, "0");
}

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
