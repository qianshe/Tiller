import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AgentMessage, AgentToolCall, SessionTimelineEntry } from "@tiller/shared";
import {
  appendMessageToSessionTimeline,
  appendToolCallToSessionTimeline,
  sortAssistantTimelineChunks,
  sortSessionTimelineEntries,
} from "@tiller/shared";
import { normalizePageLimit } from "../pagination";
import {
  decodeTimelineBlock,
  encodeTimelineBlock,
  type PositionedSessionTimelineEntry,
} from "../timeline-block-codec";
import {
  pageSessionTimeline,
  type SessionTimelinePageOptions,
} from "../timeline-store";
import { openSessionDatabase } from "./core";
import {
  createSqliteTimelineBlockIndex,
  type TimelineBlockRecord,
  type TimelineBlockState,
} from "./timeline-block-index";

export type SqliteTimelineBlockStoreOptions = {
  dbPath: string;
  blockRootPath: string;
  maxBlockBytes: number;
  maxBlockEntries: number;
  /** @internal test hook for atomic replace failure coverage. */
  testFailureAfterTempBlockWrites?: number;
};

const DEFAULT_TIMELINE_PAGE_LIMIT = 50;
const MAX_TIMELINE_PAGE_LIMIT = 200;
const ORDER_CURSOR_PREFIX = "order";

export function createSqliteTimelineBlockStore(options: SqliteTimelineBlockStoreOptions) {
  const db = openSessionDatabase(options.dbPath);
  const index = createSqliteTimelineBlockIndex(db);
  const blockRootPath = options.blockRootPath;
  const maxBlockBytes = Math.max(1, options.maxBlockBytes);
  const maxBlockEntries = Math.max(1, options.maxBlockEntries);
  mkdirSync(blockRootPath, { recursive: true });

  function upsertEntry(sessionId: string, entry: SessionTimelineEntry) {
    const existingLocation = index.getEntryLocation(sessionId, entry.id);
    if (existingLocation) {
      const block = index.getBlock(existingLocation.blockId);
      if (block) {
        const blockEntries = readBlockEntries(block);
        if (blockEntries.some((item) => item.id === entry.id)) {
          const entries = blockEntries.map((item) => item.id === entry.id
            ? { ...item, payload: normalizeTimelineEntry(entry) }
            : item,
          );
          const nextBlock = blockRecordForEntries(sessionId, block.id, block.state, block.createdAt, block.sealedAt, block.storageKey, entries);
          writeBlockFile(nextBlock, entries);
          index.upsertBlock(nextBlock);
          index.replaceBlockEntries(nextBlock.id, blockEntryRecords(sessionId, nextBlock.id, entries));
          return normalizeTimelineEntry(entry);
        }
      }
    }

    const openBlock = index.getOpenBlock(sessionId);
    const position = resolveNextPosition(sessionId);
    const positioned = positionEntry(position, normalizeTimelineEntry(entry));
    if (!openBlock) {
      writeNewOpenBlock(sessionId, [positioned]);
      return positioned.payload;
    }

    const openEntries = readBlockEntries(openBlock);
    const candidateEntries = [...openEntries, positioned];
    if (openEntries.length > 0 && exceedsOpenBlockLimit(candidateEntries)) {
      const sealed = blockRecordForEntries(
        sessionId,
        openBlock.id,
        "sealed",
        openBlock.createdAt,
        new Date().toISOString(),
        openBlock.storageKey,
        openEntries,
      );
      writeBlockFile(sealed, openEntries);
      index.upsertBlock(sealed);
      index.replaceBlockEntries(sealed.id, blockEntryRecords(sessionId, sealed.id, openEntries));
      writeNewOpenBlock(sessionId, [positioned]);
      return positioned.payload;
    }

    const nextOpen = blockRecordForEntries(
      sessionId,
      openBlock.id,
      "open",
      openBlock.createdAt,
      undefined,
      openBlock.storageKey,
      candidateEntries,
    );
    writeBlockFile(nextOpen, candidateEntries);
    index.upsertBlock(nextOpen);
    index.replaceBlockEntries(nextOpen.id, blockEntryRecords(sessionId, nextOpen.id, candidateEntries));
    return positioned.payload;
  }

  function writeNewOpenBlock(sessionId: string, entries: PositionedSessionTimelineEntry[]) {
    const firstPosition = entries[0]?.position ?? 0;
    const blockId = createBlockId(sessionId, firstPosition);
    const storageKey = createStorageKey(sessionId, blockId);
    const record = blockRecordForEntries(
      sessionId,
      blockId,
      "open",
      new Date().toISOString(),
      undefined,
      storageKey,
      entries,
    );
    writeBlockFile(record, entries);
    index.upsertBlock(record);
    index.replaceBlockEntries(record.id, blockEntryRecords(sessionId, record.id, entries));
  }

  function exceedsOpenBlockLimit(entries: PositionedSessionTimelineEntry[]) {
    return entries.length > maxBlockEntries || Buffer.byteLength(encodeTimelineBlock(entries), "utf8") > maxBlockBytes;
  }

  function resolveNextPosition(sessionId: string) {
    const latest = index.listNewestBlocks(sessionId, undefined, 1)[0];
    return (latest?.lastPosition ?? -1) + 1;
  }

  function readBlockEntries(record: TimelineBlockRecord) {
    const filePath = blockFilePath(record.storageKey);
    if (!existsSync(filePath)) {
      return [];
    }
    return decodeTimelineBlock(readFileSync(filePath, "utf8"));
  }

  function writeBlockFile(record: TimelineBlockRecord, entries: PositionedSessionTimelineEntry[]) {
    const filePath = blockFilePath(record.storageKey);
    mkdirSync(dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, encodeTimelineBlock(entries), "utf8");
    verifyBlockFile(tempPath, record);
    renameSync(tempPath, filePath);
  }

  function blockFilePath(storageKey: string) {
    return join(blockRootPath, storageKey);
  }

  function readNewestPositionedEntries(
    sessionId: string,
    beforePosition: number | undefined,
    limit: number,
  ) {
    const result: PositionedSessionTimelineEntry[] = [];
    let blockBefore = beforePosition;
    while (result.length < limit) {
      const blocks = index.listNewestBlocks(sessionId, blockBefore, 50);
      if (!blocks.length) {
        break;
      }
      for (const block of blocks) {
        const entries = readBlockEntries(block).filter((entry) =>
          beforePosition === undefined || entry.position < beforePosition,
        );
        for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
          const entry = entries[entryIndex];
          if (entry) {
            result.push(entry);
          }
          if (result.length >= limit) {
            break;
          }
        }
        if (result.length >= limit) {
          break;
        }
      }
      const oldestBlock = blocks.at(-1);
      if (!oldestBlock || oldestBlock.firstPosition === 0) {
        break;
      }
      blockBefore = oldestBlock.firstPosition;
    }
    return result;
  }

  function replaceBlocksForSession(sessionId: string, entries: SessionTimelineEntry[]) {
    const sorted = sortSessionTimelineEntries(entries).map(normalizeTimelineEntry);
    const built = buildBlockSet(sessionId, sorted);
    const encodedSessionId = encodeSessionId(sessionId);
    const tempSessionPath = join(blockRootPath, `.${encodedSessionId}.tmp-${randomUUID()}`);
    const sessionPath = join(blockRootPath, encodedSessionId);
    const backupPath = join(blockRootPath, `.${encodedSessionId}.bak-${randomUUID()}`);

    mkdirSync(tempSessionPath, { recursive: true });
    try {
      let tempBlockWriteCount = 0;
      for (const block of built.blocks) {
        if (
          options.testFailureAfterTempBlockWrites !== undefined &&
          tempBlockWriteCount >= options.testFailureAfterTempBlockWrites
        ) {
          throw new Error("Injected timeline block replace failure");
        }
        const filePath = join(tempSessionPath, basename(block.record.storageKey));
        writeFileSync(filePath, encodeTimelineBlock(block.entries), "utf8");
        verifyBlockFile(filePath, block.record);
        tempBlockWriteCount += 1;
      }

      if (existsSync(sessionPath)) {
        renameSync(sessionPath, backupPath);
      }
      try {
        renameSync(tempSessionPath, sessionPath);
        index.replaceBlocks(sessionId, built.blocks.map((block) => block.record), built.entryRecords);
        if (existsSync(backupPath)) {
          rmSync(backupPath, { force: true, recursive: true });
        }
      } catch (error) {
        if (existsSync(sessionPath)) {
          rmSync(sessionPath, { force: true, recursive: true });
        }
        if (existsSync(backupPath)) {
          renameSync(backupPath, sessionPath);
        }
        throw error;
      }
    } finally {
      if (existsSync(tempSessionPath)) {
        rmSync(tempSessionPath, { force: true, recursive: true });
      }
    }
    return sorted;
  }

  function buildBlockSet(sessionId: string, entries: SessionTimelineEntry[]) {
    const blocks: Array<{ record: TimelineBlockRecord; entries: PositionedSessionTimelineEntry[] }> = [];
    const entryRecords: ReturnType<typeof blockEntryRecords> = [];
    let current: PositionedSessionTimelineEntry[] = [];
    entries.forEach((entry, position) => {
      const positioned = positionEntry(position, entry);
      const candidate = [...current, positioned];
      if (current.length > 0 && exceedsOpenBlockLimit(candidate)) {
        blocks.push(createBuiltBlock(sessionId, current, "sealed"));
        current = [positioned];
        return;
      }
      current = candidate;
    });
    if (current.length) {
      blocks.push(createBuiltBlock(sessionId, current, "open"));
    }
    for (const block of blocks) {
      entryRecords.push(...blockEntryRecords(sessionId, block.record.id, block.entries));
    }
    return { blocks, entryRecords };
  }

  function createBuiltBlock(
    sessionId: string,
    entries: PositionedSessionTimelineEntry[],
    state: TimelineBlockState,
  ) {
    const firstPosition = entries[0]?.position ?? 0;
    const blockId = createBlockId(sessionId, firstPosition);
    return {
      entries,
      record: blockRecordForEntries(
        sessionId,
        blockId,
        state,
        new Date().toISOString(),
        state === "sealed" ? new Date().toISOString() : undefined,
        createStorageKey(sessionId, blockId),
        entries,
      ),
    };
  }

  function blockRecordForEntries(
    sessionId: string,
    blockId: string,
    state: TimelineBlockState,
    createdAt: string,
    sealedAt: string | undefined,
    storageKey: string,
    entries: PositionedSessionTimelineEntry[],
  ): TimelineBlockRecord {
    const text = encodeTimelineBlock(entries);
    return {
      id: blockId,
      sessionId,
      firstPosition: entries[0]?.position ?? 0,
      lastPosition: entries.at(-1)?.position ?? 0,
      entryCount: entries.length,
      byteSize: Buffer.byteLength(text, "utf8"),
      storageKey,
      sha256: createHash("sha256").update(text).digest("hex"),
      state,
      createdAt,
      sealedAt,
    };
  }

  function listPage(sessionId: string, pageOptions: SessionTimelinePageOptions = {}) {
    const limit = normalizePageLimit(
      pageOptions.limit,
      DEFAULT_TIMELINE_PAGE_LIMIT,
      MAX_TIMELINE_PAGE_LIMIT,
    );
    const entryLimit = pageOptions.window === "message"
      ? normalizePageLimit(pageOptions.entryLimit, MAX_TIMELINE_PAGE_LIMIT, MAX_TIMELINE_PAGE_LIMIT)
      : limit;
    const candidateLimit = Math.max(limit, entryLimit);
    const before = decodeOrderCursor(pageOptions.before);
    const newest = readNewestPositionedEntries(sessionId, before?.position, candidateLimit + 1);
    const hasOlderRows = newest.length > candidateLimit;
    const candidateRows = newest.slice(0, candidateLimit).reverse();
    const entries = candidateRows.map((row) => normalizeTimelineEntry(row.payload));
    const page = pageSessionTimeline(entries, { ...pageOptions, before: undefined });
    const hasMore = hasOlderRows || page.hasMore;
    return {
      entries: page.entries,
      nextCursor: hasMore ? encodeOrderCursor(resolvePageStartRow(candidateRows, page.entries)) : undefined,
      hasMore,
    };
  }

  return {
    append(sessionId: string, entry: SessionTimelineEntry) {
      upsertEntry(sessionId, entry);
      return this.list(sessionId);
    },
    upsertMessage(sessionId: string, message: AgentMessage) {
      const existing = index.getEntryLocation(sessionId, message.id)
        ? readExistingEntry(sessionId, message.id)
        : undefined;
      const entries = appendMessageToSessionTimeline(existing ? [existing] : [], message);
      const entry = entries.find((candidate) => candidate.id === message.id);
      return entry ? upsertEntry(sessionId, entry) : undefined;
    },
    upsertToolCall(sessionId: string, toolCall: AgentToolCall) {
      const entryId = resolveToolCallTimelineEntryId(toolCall);
      const existing = index.getEntryLocation(sessionId, entryId)
        ? readExistingEntry(sessionId, entryId)
        : undefined;
      const entries = appendToolCallToSessionTimeline(existing ? [existing] : [], toolCall);
      const entry = entries.find((candidate) => candidate.id === entryId);
      return entry ? upsertEntry(sessionId, entry) : undefined;
    },
    replace(sessionId: string, entries: SessionTimelineEntry[]) {
      return replaceBlocksForSession(sessionId, entries);
    },
    applyBatch(sessionId: string, batch: import("@tiller/shared").SessionTimelineBatch) {
      if (batch.replace) {
        return replaceBlocksForSession(sessionId, batch.entries);
      }
      const current = this.list(sessionId);
      const byId = new Map(current.map((entry) => [entry.id, entry]));
      for (const entry of batch.entries) {
        byId.set(entry.id, entry);
      }
      return replaceBlocksForSession(sessionId, [...byId.values()]);
    },
    list(sessionId: string) {
      return readNewestPositionedEntries(sessionId, undefined, Number.MAX_SAFE_INTEGER)
        .reverse()
        .map((entry) => normalizeTimelineEntry(entry.payload));
    },
    listPage,
    remove(sessionId: string) {
      index.removeSession(sessionId);
      const sessionPath = join(blockRootPath, encodeSessionId(sessionId));
      rmSync(sessionPath, { force: true, recursive: true });
    },
    close() {
      db.close();
    },
  };

  function readExistingEntry(sessionId: string, entryId: string) {
    const location = index.getEntryLocation(sessionId, entryId);
    const block = location ? index.getBlock(location.blockId) : undefined;
    return block
      ? readBlockEntries(block).find((entry) => entry.id === entryId)?.payload
      : undefined;
  }
}

function verifyBlockFile(filePath: string, record: TimelineBlockRecord) {
  const text = readFileSync(filePath, "utf8");
  const entries = decodeTimelineBlock(text);
  const byteSize = Buffer.byteLength(text, "utf8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  if (
    entries.length !== record.entryCount ||
    byteSize !== record.byteSize ||
    sha256 !== record.sha256 ||
    (entries[0]?.position ?? 0) !== record.firstPosition ||
    (entries.at(-1)?.position ?? 0) !== record.lastPosition
  ) {
    throw new Error(`Timeline block verification failed for ${record.id}`);
  }
}

function positionEntry(position: number, entry: SessionTimelineEntry): PositionedSessionTimelineEntry {
  return {
    position,
    id: entry.id,
    kind: entry.kind,
    timestamp: entry.timestamp,
    payload: entry,
  };
}

function blockEntryRecords(sessionId: string, blockId: string, entries: PositionedSessionTimelineEntry[]) {
  return entries.map((entry) => ({
    sessionId,
    entryId: entry.id,
    blockId,
    position: entry.position,
  }));
}

function normalizeTimelineEntry(entry: SessionTimelineEntry): SessionTimelineEntry {
  if (entry.kind !== "assistant_message") {
    return entry;
  }
  return {
    ...entry,
    chunks: sortAssistantTimelineChunks(entry.chunks),
  };
}

function resolveToolCallTimelineEntryId(toolCall: AgentToolCall) {
  if (toolCall.kind === "think") {
    const sourceId = toolCall.commandId ?? toolCall.id;
    return stripThinkingSuffix(sourceId) ?? stripThinkingSuffix(toolCall.id) ?? sourceId;
  }
  return `tool:${toolCall.id}`;
}

function stripThinkingSuffix(value: string) {
  return value.endsWith(":thinking") ? value.slice(0, -":thinking".length) : null;
}

function createBlockId(sessionId: string, firstPosition: number) {
  return `${encodeSessionId(sessionId)}-${firstPosition}`;
}

function createStorageKey(sessionId: string, blockId: string) {
  return join(encodeSessionId(sessionId), `${blockId}.jsonl`);
}

function encodeSessionId(sessionId: string) {
  return encodeURIComponent(sessionId).replace(/[!'()*]/gu, (value) => `%${value.codePointAt(0)?.toString(16).toUpperCase()}`);
}

function encodeOrderCursor(row: PositionedSessionTimelineEntry | undefined) {
  return row ? `${ORDER_CURSOR_PREFIX}\t${row.position}\t${row.id}` : undefined;
}

function decodeOrderCursor(cursor: string | undefined) {
  if (!cursor) {
    return null;
  }
  const [prefix, position] = cursor.split("\t");
  if (prefix !== ORDER_CURSOR_PREFIX || !position) {
    return null;
  }
  const parsedPosition = Number.parseInt(position, 10);
  return Number.isFinite(parsedPosition) && parsedPosition >= 0
    ? { position: parsedPosition }
    : null;
}

function resolvePageStartRow(
  rows: PositionedSessionTimelineEntry[],
  entries: SessionTimelineEntry[],
) {
  const firstEntry = entries[0];
  if (!firstEntry) {
    return undefined;
  }
  return rows.find((row) => row.id === firstEntry.id);
}
