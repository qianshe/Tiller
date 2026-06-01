export type SessionTimelineBlockMode = "sqlite_rows" | "blocks_shadow" | "blocks_read";

export type SessionTimelineBlockConfig = {
  blockRootPath: string;
  maxBlockBytes: number;
  maxBlockEntries: number;
  mode: SessionTimelineBlockMode;
};
