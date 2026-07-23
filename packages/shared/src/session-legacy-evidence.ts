export const LEGACY_EVIDENCE_SOURCES = ["message", "tool_call", "output"] as const;

export type LegacyEvidenceSource = (typeof LEGACY_EVIDENCE_SOURCES)[number];

export type LegacyEvidenceEntity = Record<string, unknown> & { id?: unknown };

export type LegacyEvidenceItem = {
  source: LegacyEvidenceSource;
  sourcePosition: number;
  entity: LegacyEvidenceEntity;
};

export type LegacyEvidenceIssue = {
  source: LegacyEvidenceSource;
  sourcePosition: number;
  code: "invalid_payload" | "payload_too_large";
  payloadBytes?: number;
  preview?: string;
};

export type LegacyEvidenceAvailability = {
  sessionId: string;
  available: boolean;
  counts: Record<LegacyEvidenceSource, number>;
};

export type LegacyEvidencePage = {
  sessionId: string;
  source: LegacyEvidenceSource;
  items: LegacyEvidenceItem[];
  issues: LegacyEvidenceIssue[];
  nextCursor?: string;
  hasMore: boolean;
};

export type LegacyEvidencePageRequest = {
  source: LegacyEvidenceSource;
  limit?: number;
  after?: string;
};
