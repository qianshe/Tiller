import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpdateNotice,
  clearUpdateVersionCache,
  createUpdateCheckService,
  formatExplicitUpdateOutput,
  formatStartupUpdateNotice,
  loadUpdateVersions,
  resolveUpdateOptions,
} from "./check.js";
import { fetchTillerNpmDistTags } from "./npm-registry.js";

test("resolveUpdateOptions defaults checks and preview hints on", () => {
  assert.deepEqual(resolveUpdateOptions({ env: {}, config: {} }), {
    checkOnStart: true,
    previewHint: true,
  });
});

test("resolveUpdateOptions lets env disable startup checks and preview hints", () => {
  assert.deepEqual(
    resolveUpdateOptions({
      env: { TILLER_UPDATE_CHECK: "0", TILLER_UPDATE_PREVIEW_HINT: "0" },
      config: { updates: { checkOnStart: true, previewHint: true } },
    }),
    { checkOnStart: false, previewHint: false },
  );
});

test("buildUpdateNotice prefers latest update", () => {
  assert.deepEqual(
    buildUpdateNotice(
      { current: "0.1.0", latest: "0.1.1", preview: "0.2.0-alpha.1" },
      { checkOnStart: true, previewHint: true },
    ),
    { kind: "latest-update", current: "0.1.0", latest: "0.1.1" },
  );
});

test("buildUpdateNotice returns preview hint when latest is not newer", () => {
  assert.deepEqual(
    buildUpdateNotice(
      { current: "0.1.1", latest: "0.1.1", preview: "0.2.0-alpha.1" },
      { checkOnStart: true, previewHint: true },
    ),
    { kind: "preview-hint", current: "0.1.1", preview: "0.2.0-alpha.1" },
  );
});

test("startup latest notice points to tiller update", () => {
  assert.deepEqual(
    formatStartupUpdateNotice({ kind: "latest-update", current: "0.1.0", latest: "0.1.1" }),
    ["[tiller] Update available: 0.1.0 -> 0.1.1", "[tiller] Run: tiller update"],
  );
});

test("explicit latest output says it will run npm latest", () => {
  assert.equal(
    formatExplicitUpdateOutput({ kind: "latest-update", current: "0.1.0", latest: "0.1.1" }),
    [
      "Tiller update available: 0.1.0 -> 0.1.1",
      "Running:",
      "  npm install -g @qianshe/tiller@latest",
    ].join("\n"),
  );
});

test("explicit preview output stays hint-only", () => {
  assert.equal(
    formatExplicitUpdateOutput({
      kind: "preview-hint",
      current: "0.1.1",
      preview: "0.2.0-alpha.1",
    }),
    [
      "Tiller is up to date on latest: 0.1.1",
      "Preview available: 0.2.0-alpha.1",
      "Try it with:",
      "  npm install -g @qianshe/tiller@preview",
    ].join("\n"),
  );
});

test("update check reports a newer latest version", async () => {
  const checker = createUpdateCheckService({
    currentVersion: "1.0.0",
    canUpdate: true,
    loadVersions: async () => ({ current: "1.0.0", latest: "1.1.0" }),
    now: () => "2026-08-02T00:00:00.000Z",
  });

  assert.deepEqual(await checker.check(true), {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateAvailable: true,
    canUpdate: true,
    checkStatus: "checked",
    checkedAt: "2026-08-02T00:00:00.000Z",
  });
});

test("update check reports registry failures with a failed result", async () => {
  const checker = createUpdateCheckService({
    currentVersion: "1.0.0",
    canUpdate: true,
    loadVersions: async () => {
      throw new Error("registry unavailable");
    },
  });

  await assert.rejects(
    checker.check(true),
    (error: unknown) => {
      assert.equal((error as Error).message, "registry unavailable");
      assert.equal((error as { result?: { checkStatus?: string } }).result?.checkStatus, "failed");
      return true;
    },
  );
});

test("missing npm latest is reported as a registry failure", async () => {
  clearUpdateVersionCache();

  await assert.rejects(
    loadUpdateVersions("1.0.0", { fetchTags: async () => ({}) }),
    /latest version/,
  );
});

test("npm registry responses without latest are rejected", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ "dist-tags": {} }),
  }) as Response;

  await assert.rejects(fetchTillerNpmDistTags(fetchImpl), /latest version/);
});

test("non-forced failed version loads reuse a recent failure while force retries", async () => {
  clearUpdateVersionCache();
  let calls = 0;
  const fetchTags = async (): Promise<{ latest: string }> => {
    calls += 1;
    throw new Error("registry unavailable");
  };

  await assert.rejects(loadUpdateVersions("1.0.0", { fetchTags }), /registry unavailable/);
  await assert.rejects(loadUpdateVersions("1.0.0", { fetchTags }), /registry unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(
    loadUpdateVersions("1.0.0", { fetchTags, force: true }),
    /registry unavailable/,
  );
  assert.equal(calls, 2);
});

test("concurrent update checks share one in-flight registry request", async () => {
  let calls = 0;
  let resolveVersions!: (versions: { current: string; latest: string }) => void;
  const checker = createUpdateCheckService({
    currentVersion: "1.0.0",
    canUpdate: true,
    loadVersions: async () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveVersions = resolve;
      });
    },
  });

  const first = checker.check(true);
  const second = checker.check(true);
  assert.equal(calls, 1);
  resolveVersions({ current: "1.0.0", latest: "1.1.0" });
  assert.equal((await first).latestVersion, "1.1.0");
  assert.equal((await second).latestVersion, "1.1.0");
});

test("non-forced failed checks reuse a recent failure while force retries", async () => {
  let calls = 0;
  const checker = createUpdateCheckService({
    currentVersion: "1.0.0",
    canUpdate: true,
    loadVersions: async () => {
      calls += 1;
      throw new Error("registry unavailable");
    },
  });

  await assert.rejects(checker.check(false), /registry unavailable/);
  await assert.rejects(checker.check(false), /registry unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(checker.check(true), /registry unavailable/);
  assert.equal(calls, 2);
});

test("manual force check works when startup checks are disabled", async () => {
  let calls = 0;
  const service = createUpdateCheckService({
    currentVersion: "1.0.0",
    canUpdate: true,
    loadVersions: async () => {
      calls += 1;
      return { current: "1.0.0", latest: "1.1.0" };
    },
  });
  const disabled = resolveUpdateOptions({ env: { TILLER_UPDATE_CHECK: "0" }, config: {} });

  assert.equal(disabled.checkOnStart, false);
  assert.equal((await service.check(true)).updateAvailable, true);
  assert.equal(calls, 1);
});

test("loadUpdateVersions caches registry tags briefly and force bypasses the cache", async () => {
  clearUpdateVersionCache();
  let calls = 0;
  const fetchTags = async (): Promise<{ latest: string }> => {
    calls += 1;
    return { latest: "1.1.0" };
  };

  await loadUpdateVersions("1.0.0", { fetchTags, now: 1000 });
  await loadUpdateVersions("1.0.0", { fetchTags, now: 2000 });
  await loadUpdateVersions("1.0.0", { fetchTags, now: 2000, force: true });
  assert.equal(calls, 2);
});

test("concurrent version loads share one registry request", async () => {
  clearUpdateVersionCache();
  let calls = 0;
  let resolveTags!: (tags: { latest: string }) => void;
  const fetchTags = async (): Promise<{ latest: string }> => {
    calls += 1;
    return new Promise((resolve) => {
      resolveTags = resolve;
    });
  };

  const first = loadUpdateVersions("1.0.0", { fetchTags });
  const second = loadUpdateVersions("1.0.0", { fetchTags, force: true });
  assert.equal(calls, 1);
  resolveTags({ latest: "1.1.0" });
  assert.equal((await first).latest, "1.1.0");
  assert.equal((await second).latest, "1.1.0");
});
