import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadStaticAsset } from "./static-assets.js";

test("loadStaticAsset serves requested files under the Deck root", async () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-deck-"));
  try {
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app.js"), "console.log('ok')");

    const asset = await loadStaticAsset(root, "/assets/app.js");

    assert.equal(asset.ok, true);
    assert.equal(asset.ok && asset.contentType, "text/javascript; charset=utf-8");
    assert.equal(asset.ok && asset.immutable, true);
    assert.equal(asset.ok && asset.body.toString("utf8"), "console.log('ok')");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadStaticAsset falls back to index.html for app routes", async () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-deck-"));
  try {
    writeFileSync(join(root, "index.html"), '<div id="root"></div>');

    const asset = await loadStaticAsset(root, "/missions/abc");

    assert.equal(asset.ok, true);
    assert.equal(asset.ok && asset.contentType, "text/html; charset=utf-8");
    assert.equal(asset.ok && asset.immutable, false);
    assert.equal(asset.ok && asset.body.toString("utf8"), '<div id="root"></div>');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadStaticAsset rejects path traversal", async () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-deck-"));
  try {
    writeFileSync(join(root, "index.html"), "safe");

    const asset = await loadStaticAsset(root, "/../secret.txt");

    assert.equal(asset.ok, false);
    assert.equal(!asset.ok && asset.statusCode, 403);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
