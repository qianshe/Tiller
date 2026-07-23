import type {
  LegacyEvidenceAvailability,
  LegacyEvidencePage,
  LegacyEvidencePageRequest,
} from "@tiller/shared";

export type SessionLegacyEvidenceStore = {
  describe(sessionId: string): LegacyEvidenceAvailability;
  listPage(sessionId: string, request: LegacyEvidencePageRequest): LegacyEvidencePage;
  close?(): void;
};
