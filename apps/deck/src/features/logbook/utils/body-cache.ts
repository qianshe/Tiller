export type HydratedBodyCacheEntry = {
  entityKey: string;
  content: string;
  byteSize: number;
  lastAccessTick: number;
};

export function createHydratedBodyCache(maxBytes: number) {
  const entries = new Map<string, HydratedBodyCacheEntry>();
  let totalBytes = 0;
  let tick = 0;

  function get(entityKey: string) {
    const entry = entries.get(entityKey);
    if (!entry) return undefined;
    entry.lastAccessTick = ++tick;
    return entry.content;
  }

  function set(entityKey: string, content: string) {
    const byteSize = new TextEncoder().encode(content).byteLength;
    const previous = entries.get(entityKey);
    if (previous) totalBytes -= previous.byteSize;
    if (byteSize > maxBytes) {
      entries.delete(entityKey);
      return false;
    }
    entries.set(entityKey, {
      entityKey,
      content,
      byteSize,
      lastAccessTick: ++tick,
    });
    totalBytes += byteSize;
    while (totalBytes > maxBytes) {
      const oldest = [...entries.values()].reduce((left, right) =>
        left.lastAccessTick <= right.lastAccessTick ? left : right
      );
      entries.delete(oldest.entityKey);
      totalBytes -= oldest.byteSize;
    }
    return true;
  }

  return {
    get,
    set,
    clear() {
      entries.clear();
      totalBytes = 0;
    },
    stats() {
      return { entries: entries.size, totalBytes, maxBytes };
    },
  };
}

export const hydratedBodyCache = createHydratedBodyCache(4 * 1024 * 1024);
