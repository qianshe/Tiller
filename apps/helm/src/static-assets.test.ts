import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveStaticAsset } from "./static-assets.js";

test("resolveStaticAsset serves requested files under the Deck root", () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-deck-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app.js"), "console.log('ok')");

    const asset = resolveStaticAsset(root, "/assets/app.js");

    assert.equal(asset.ok, true);
    assert.equal(asset.ok && asset.filePath, join(root, "assets", "app.js"));
    assert.equal(asset.ok && asset.contentType, "text/javascript; charset=utf-8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveStaticAsset falls back to index.html for app routes", () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-deck-"));
  try {
    writeFileSync(join(root, "index.html"), "<div id=\"root\"></div>");

    const asset = resolveStaticAsset(root, "/missions/abc");

    assert.equal(asset.ok, true);
    assert.equal(asset.ok && asset.filePath, join(root, "index.html"));
    assert.equal(asset.ok && asset.contentType, "text/html; charset=utf-8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveStaticAsset rejects path traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-deck-"));
  try {
    writeFileSync(join(root, "index.html"), "safe");

    const asset = resolveStaticAsset(root, "/../secret.txt");

    assert.equal(asset.ok, false);
    assert.equal(asset.statusCode, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
