import {
  createSqliteSessionTimelineStore,
  createSqliteTimelineBlockStore,
  type SessionTimelineBlockMode,
  type SessionTimelineStore,
} from "@tiller/persistence";
import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineBatch,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";

export type TimelineStoreModeOptions = {
  sqlitePath: string;
  blockRootPath: string;
  mode?: string;
  logDebug?: (message: string) => void;
};

type ClosableTimelineStore = SessionTimelineStore & { close?: () => void };

export function createModeAwareSessionTimelineStore(
  options: TimelineStoreModeOptions,
): ClosableTimelineStore {
  const mode = resolveTimelineBlockMode(options.mode);
  const rowStore = createSqliteSessionTimelineStore(options.sqlitePath) as ClosableTimelineStore;
  if (mode === "sqlite_rows") {
    return rowStore;
  }

  const blockStore = createSqliteTimelineBlockStore({
    dbPath: options.sqlitePath,
    blockRootPath: options.blockRootPath,
    maxBlockBytes: 512 * 1024,
    maxBlockEntries: 500,
  }) as ClosableTimelineStore;
  return createDualTimelineStore({
    mode,
    rowStore,
    blockStore,
    logDebug: options.logDebug,
  });
}

export function resolveTimelineBlockMode(value: string | undefined): SessionTimelineBlockMode {
  if (value === "blocks_shadow" || value === "blocks_read") {
    return value;
  }
  return "sqlite_rows";
}

type DualTimelineStoreOptions = {
  mode: Exclude<SessionTimelineBlockMode, "sqlite_rows">;
  rowStore: ClosableTimelineStore;
  blockStore: ClosableTimelineStore;
  logDebug?: (message: string) => void;
};

function createDualTimelineStore(options: DualTimelineStoreOptions): ClosableTimelineStore {
  const readStore = options.mode === "blocks_read" ? options.blockStore : options.rowStore;

  function compareListPage(sessionId: string, pageOptions?: Parameters<SessionTimelineStore["listPage"]>[1]) {
    if (options.mode !== "blocks_shadow") {
      return;
    }
    const rowPage = options.rowStore.listPage(sessionId, pageOptions);
    const blockPage = options.blockStore.listPage(sessionId, pageOptions);
    options.logDebug?.(`timeline.block.parity=${sameEntryPage(rowPage.entries, blockPage.entries) && rowPage.hasMore === blockPage.hasMore ? "ok" : "mismatch"}`);
  }

  return {
    upsertMessage(sessionId: string, message: AgentMessage) {
      if (!options.rowStore.upsertMessage || !options.blockStore.upsertMessage) {
        return undefined;
      }
      const row = options.rowStore.upsertMessage(sessionId, message);
      const block = options.blockStore.upsertMessage(sessionId, message);
      return readStore === options.blockStore ? block : row;
    },
    upsertToolCall(sessionId: string, toolCall: AgentToolCall) {
      if (!options.rowStore.upsertToolCall || !options.blockStore.upsertToolCall) {
        return undefined;
      }
      const row = options.rowStore.upsertToolCall(sessionId, toolCall);
      const block = options.blockStore.upsertToolCall(sessionId, toolCall);
      return readStore === options.blockStore ? block : row;
    },
    replace(sessionId: string, entries: SessionTimelineEntry[]) {
      const row = options.rowStore.replace(sessionId, entries);
      const block = options.blockStore.replace(sessionId, entries);
      return readStore === options.blockStore ? block : row;
    },
    applyBatch(sessionId: string, batch: SessionTimelineBatch) {
      const row = options.rowStore.applyBatch(sessionId, batch);
      const block = options.blockStore.applyBatch(sessionId, batch);
      return readStore === options.blockStore ? block : row;
    },
    commitBatch(
      sessionId: string,
      batch: SessionTimelineBatch,
      updates: SessionUpdateRecord[],
    ) {
      if (!options.rowStore.commitBatch) {
        throw new Error("SQLite timeline store does not support atomic update commits.");
      }
      const row = options.rowStore.commitBatch(sessionId, batch, updates);
      const block = options.blockStore.applyBatch(sessionId, batch);
      return readStore === options.blockStore ? block : row;
    },
    list(sessionId: string) {
      const result = readStore.list(sessionId);
      if (options.mode === "blocks_shadow") {
        const block = options.blockStore.list(sessionId);
        options.logDebug?.(`timeline.block.parity=${sameEntryPage(result, block) ? "ok" : "mismatch"}`);
      }
      return result;
    },
    listPage(sessionId: string, pageOptions) {
      const result = readStore.listPage(sessionId, pageOptions);
      compareListPage(sessionId, pageOptions);
      return result;
    },
    remove(sessionId: string) {
      options.rowStore.remove(sessionId);
      options.blockStore.remove(sessionId);
    },
    close() {
      options.rowStore.close?.();
      options.blockStore.close?.();
    },
  };
}

function sameEntryPage(left: SessionTimelineEntry[], right: SessionTimelineEntry[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}
