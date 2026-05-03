import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type StaticAssetResponse =
  | { ok: true; body: Buffer; contentType: string; immutable: boolean }
  | { ok: false; statusCode: 403 | 404 };

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

type CachedAsset = {
  body: Buffer;
  contentType: string;
  immutable: boolean;
  /** Defined for the (mutable) HTML entry so we can detect rebuilds via mtime. */
  mtimeMs?: number;
};

const ASSET_CACHE = new Map<string, CachedAsset>();

export function resolveDeckStaticDir(moduleUrl = import.meta.url) {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const packagedDir = resolve(moduleDir, "deck");
  if (existsSync(resolve(packagedDir, "index.html"))) {
    return packagedDir;
  }

  return resolve(moduleDir, "..", "..", "deck", "dist");
}

export async function loadStaticAsset(rootDir: string, requestUrl = "/"): Promise<StaticAssetResponse> {
  if (hasTraversalSegment(requestUrl)) {
    return { ok: false, statusCode: 403 };
  }

  const url = new URL(requestUrl, "http://tiller.local");
  const pathname = decodeURIComponent(url.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(rootDir, normalize(relativePath));
  if (!isInsideRoot(rootDir, candidate)) {
    return { ok: false, statusCode: 403 };
  }

  const direct = await loadCachedAsset(candidate);
  if (direct) {
    return { ok: true, ...direct };
  }

  const fallback = await loadCachedAsset(resolve(rootDir, "index.html"));
  if (fallback) {
    return { ok: true, ...fallback };
  }

  return { ok: false, statusCode: 404 };
}

async function loadCachedAsset(filePath: string): Promise<{ body: Buffer; contentType: string; immutable: boolean } | null> {
  const isHtmlEntry = filePath.endsWith("index.html");
  const cached = ASSET_CACHE.get(filePath);

  if (cached && !isHtmlEntry) {
    return { body: cached.body, contentType: cached.contentType, immutable: true };
  }

  let mtimeMs: number | undefined;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return null;
    }
    if (isHtmlEntry) {
      mtimeMs = info.mtimeMs;
      if (cached && cached.mtimeMs === mtimeMs) {
        return { body: cached.body, contentType: cached.contentType, immutable: false };
      }
    }
  } catch {
    return null;
  }

  let body: Buffer;
  try {
    body = await readFile(filePath);
  } catch {
    return null;
  }
  const contentType = contentTypeFor(filePath);
  const immutable = !isHtmlEntry;
  ASSET_CACHE.set(filePath, { body, contentType, immutable, mtimeMs });
  return { body, contentType, immutable };
}

function isInsideRoot(rootDir: string, candidate: string) {
  const root = resolve(rootDir);
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function hasTraversalSegment(requestUrl: string) {
  try {
    return decodeURIComponent(requestUrl).split(/[\\/]/u).some((segment) => segment === "..");
  } catch {
    return true;
  }
}

function contentTypeFor(filePath: string) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
