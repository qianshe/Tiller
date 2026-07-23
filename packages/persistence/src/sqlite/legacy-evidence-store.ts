import type {
  LegacyEvidenceAvailability,
  LegacyEvidenceEntity,
  LegacyEvidencePage,
  LegacyEvidencePageRequest,
  LegacyEvidenceSource,
} from "@tiller/shared";
import type { SessionLegacyEvidenceStore } from "../legacy-evidence-store";
import { openSessionDatabase, type DatabaseSync } from "./core";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const MAX_EVIDENCE_PAYLOAD_BYTES = 16 * 1024;
const MAX_EVIDENCE_PREVIEW_CHARS = 8 * 1024;

type EvidenceRow = {
  source_position: number;
  payload_bytes: number;
  payload_json: string;
};

const TABLE_BY_SOURCE: Record<LegacyEvidenceSource, string> = {
  message: "session_messages",
  tool_call: "session_tool_calls",
  output: "session_outputs",
};

export function createSqliteSessionLegacyEvidenceStore(
  dbPath: string,
): SessionLegacyEvidenceStore & { close(): void } {
  const db = openSessionDatabase(dbPath);

  return {
    describe(sessionId) {
      const counts = {
        message: countRows(db, "session_messages", sessionId),
        tool_call: countRows(db, "session_tool_calls", sessionId),
        output: countRows(db, "session_outputs", sessionId),
      };
      return {
        sessionId,
        available: counts.message + counts.tool_call + counts.output > 0,
        counts,
      };
    },
    listPage(sessionId, request) {
      const limit = normalizeLimit(request.limit);
      const after = parseCursor(request.after);
      const table = TABLE_BY_SOURCE[request.source];
      const rows = db.prepare(`
        SELECT
          rowid AS source_position,
          length(CAST(payload_json AS BLOB)) AS payload_bytes,
          CASE
            WHEN length(CAST(payload_json AS BLOB)) > ? THEN substr(payload_json, 1, ?)
            ELSE payload_json
          END AS payload_json
        FROM ${table}
        WHERE session_id = ? AND rowid > ?
        ORDER BY rowid ASC
        LIMIT ?
      `).all(
        MAX_EVIDENCE_PAYLOAD_BYTES,
        MAX_EVIDENCE_PREVIEW_CHARS,
        sessionId,
        after,
        limit + 1,
      ) as EvidenceRow[];
      const selected = rows.slice(0, limit);
      const items: LegacyEvidencePage["items"] = [];
      const issues: LegacyEvidencePage["issues"] = [];
      for (const row of selected) {
        if (row.payload_bytes > MAX_EVIDENCE_PAYLOAD_BYTES) {
          issues.push({
            source: request.source,
            sourcePosition: row.source_position,
            code: "payload_too_large",
            payloadBytes: row.payload_bytes,
            preview: row.payload_json,
          });
          continue;
        }
        const entity = parseLegacyEvidenceEntity(row.payload_json);
        if (entity) {
          items.push({
            source: request.source,
            sourcePosition: row.source_position,
            entity,
          });
        } else {
          issues.push({
            source: request.source,
            sourcePosition: row.source_position,
            code: "invalid_payload",
          });
        }
      }
      const hasMore = rows.length > limit;
      return {
        sessionId,
        source: request.source,
        items,
        issues,
        ...(hasMore && selected.length > 0
          ? { nextCursor: String(selected.at(-1)?.source_position) }
          : {}),
        hasMore,
      };
    },
    close() {
      db.close();
    },
  };
}

function countRows(db: DatabaseSync, table: string, sessionId: string) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE session_id = ?`)
    .get(sessionId) as { count: number };
  return row.count;
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(value, MAX_PAGE_LIMIT);
}

function parseCursor(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseLegacyEvidenceEntity(payload: string): LegacyEvidenceEntity | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as LegacyEvidenceEntity
      : undefined;
  } catch {
    return undefined;
  }
}
