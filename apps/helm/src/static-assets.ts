import { existsSync, statSync } from "node:fs";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type StaticAssetResult =
  | { ok: true; filePath: string; contentType: string }
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

export function resolveDeckStaticDir(moduleUrl = import.meta.url) {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const packagedDir = resolve(moduleDir, "deck");
  if (existsSync(resolve(packagedDir, "index.html"))) {
    return packagedDir;
  }

  return resolve(moduleDir, "..", "..", "deck", "dist");
}

export function resolveStaticAsset(rootDir: string, requestUrl = "/"): StaticAssetResult {
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

  if (isReadableFile(candidate)) {
    return { ok: true, filePath: candidate, contentType: contentTypeFor(candidate) };
  }

  const fallback = resolve(rootDir, "index.html");
  if (isReadableFile(fallback)) {
    return { ok: true, filePath: fallback, contentType: contentTypeFor(fallback) };
  }

  return { ok: false, statusCode: 404 };
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

function isReadableFile(filePath: string) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function contentTypeFor(filePath: string) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}
