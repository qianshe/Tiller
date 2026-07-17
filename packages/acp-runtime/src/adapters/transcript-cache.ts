import { existsSync, readFileSync, statSync } from "node:fs";

const DEFAULT_MAX_CACHE_ENTRIES = 32;

type TranscriptCacheEntry<Value> = {
  path: string;
  size: number;
  modifiedAt: number;
  value: Value;
};

export function createCachedTranscriptParser<Context, Value>(options: {
  cacheKey: (context: Context) => string;
  resolvePath: (context: Context) => string | null | undefined;
  parse: (raw: string) => Value;
  maxEntries?: number;
}) {
  const cache = new Map<string, TranscriptCacheEntry<Value>>();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;

  return (context: Context): Value | undefined => {
    const key = options.cacheKey(context);
    const cached = cache.get(key);
    const cachedPath = cached?.path;
    const path = cachedPath && existsSync(cachedPath)
      ? cachedPath
      : options.resolvePath(context);
    if (!path || !existsSync(path)) {
      cache.delete(key);
      return undefined;
    }

    const stats = statSync(path);
    if (
      cached?.path === path &&
      cached.size === stats.size &&
      cached.modifiedAt === stats.mtimeMs
    ) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.value;
    }

    const value = options.parse(readFileSync(path, "utf8"));
    cache.set(key, {
      path,
      size: stats.size,
      modifiedAt: stats.mtimeMs,
      value,
    });
    trimCache(cache, maxEntries);
    return value;
  };
}

function trimCache<Value>(
  cache: Map<string, TranscriptCacheEntry<Value>>,
  maxEntries: number,
) {
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      return;
    }
    cache.delete(oldestKey);
  }
}
