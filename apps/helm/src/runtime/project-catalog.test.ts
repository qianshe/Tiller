import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveProjectYaml } from "@tiller/agent-registry";
import { createProjectCatalog } from "./project-catalog.js";

function makeCatalog(configPath: string, defaultWorktreeRoot: string) {
  return createProjectCatalog({
    configPath,
    host: "127.0.0.1",
    port: 47631,
    defaultWorktreeRoot,
  });
}

test("loadAvailableWorktrees aggregates configured project worktrees, never the helm cwd", () => {
  const dir = mkdtempSync(join(tmpdir(), "tiller-catalog-"));
  try {
    const configPath = join(dir, "config.json");
    saveProjectYaml(
      {
        id: "project-1",
        name: "Alpha",
        helmId: "local-helm",
        path: "D:/repos/alpha",
        worktrees: [{ name: "main", path: "D:/repos/alpha", branch: "main", kind: "root" }],
      },
      configPath,
    );
    // helm dev 的 cwd 通常是 apps/helm，不应被当成工作区
    const catalog = makeCatalog(configPath, "D:/repos/alpha/apps/helm");
    const worktrees = catalog.loadAvailableWorktrees();
    assert.deepEqual(
      worktrees.map((worktree) => worktree.path),
      ["D:/repos/alpha"],
    );
    assert.ok(!worktrees.some((worktree) => worktree.path.endsWith("/apps/helm")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadAvailableWorktrees dedupes worktrees across configured projects", () => {
  const dir = mkdtempSync(join(tmpdir(), "tiller-catalog-"));
  try {
    const configPath = join(dir, "config.json");
    saveProjectYaml(
      {
        id: "project-1",
        name: "Alpha",
        helmId: "local-helm",
        path: "D:/repos/alpha",
        worktrees: [{ name: "main", path: "D:/repos/alpha", branch: "main", kind: "root" }],
      },
      configPath,
    );
    saveProjectYaml(
      {
        id: "project-2",
        name: "Beta",
        helmId: "local-helm",
        path: "D:/repos/beta",
        worktrees: [{ name: "main", path: "D:/repos/beta", branch: "main", kind: "root" }],
      },
      configPath,
    );
    const catalog = makeCatalog(configPath, "D:/repos/alpha/apps/helm");
    const paths = catalog.loadAvailableWorktrees().map((worktree) => worktree.path).sort();
    assert.deepEqual(paths, ["D:/repos/alpha", "D:/repos/beta"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadAvailableWorktrees falls back to the process cwd only when no projects are configured", () => {
  const dir = mkdtempSync(join(tmpdir(), "tiller-catalog-"));
  try {
    const configPath = join(dir, "config.json");
    const catalog = makeCatalog(configPath, "D:/repos/sandbox");
    const worktrees = catalog.loadAvailableWorktrees();
    assert.deepEqual(worktrees, [{ name: "sandbox", path: "D:/repos/sandbox" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
