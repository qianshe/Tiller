import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { ensureTillerConfigDefaults, readProjectYaml, saveProjectYaml } from "@tiller/agent-registry";
import { handleConfigRpcRequest } from "./rpc";

test("config RPC lists helms and updates context cache", async () => {
  let cached: unknown[] = [];
  const helms = [{ id: "local", name: "Local", url: "ws://127.0.0.1" }];

  const result = await handleConfigRpcRequest("helm/list", {}, {
    loadAvailableHelms: () => helms,
    setHelms: (items: unknown[]) => {
      cached = items;
    },
  } as any);

  assert.deepEqual(result, { helms });
  assert.equal(cached, helms);
});

test("config RPC lists projects and updates context cache", async () => {
  let cached: unknown[] = [];
  const projects = [{ id: "p1", name: "Project", helmId: "local" }];

  const result = await handleConfigRpcRequest("project/list", {}, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => [],
    configPath: join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json"),
    setProjects: (items: unknown[]) => {
      cached = items;
    },
    logError: () => undefined,
  } as any);

  assert.deepEqual(result, { projects });
  assert.equal(cached, projects);
});

test("config RPC lists local directory candidates", async () => {
  const root = mkdtempSync(join(tmpdir(), "tiller-config-directories-"));
  const repoPath = join(root, "repo");
  mkdirSync(repoPath);

  const result = await handleConfigRpcRequest("project/list_directories", { path: root }, {} as any) as {
    ok: boolean;
    directories: string[];
  };

  assert.equal(result.ok, true);
  assert.deepEqual(result.directories, [repoPath.replace(/\\/g, "/")]);
});

test("config RPC lists only the requested project's worktrees", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];

  const result = await handleConfigRpcRequest("project/list_worktrees", { projectId: "p1" }, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    setProjects: () => undefined,
    setWorktrees: () => undefined,
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any) as { worktrees: Array<{ path: string }> };

  assert.deepEqual(result.worktrees.map((worktree) => worktree.path), ["D:/repo-one"]);
});

test("config RPC rejects git status requests for another project's worktree", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];

  const result = await handleConfigRpcRequest("project/git/status", {
    projectId: "p1",
    cwd: "D:/repo-two",
  }, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any) as { ok: boolean; message: string };

  assert.equal(result.ok, false);
  assert.equal(result.message, "Working directory is not part of this project");
});

test(
  "config RPC keeps project cwd authorization case-sensitive on case-sensitive filesystems",
  { skip: process.platform === "win32" },
  async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-cwd-case-"));
    const configuredRepo = join(tempRoot, "Repo");
    const foreignRepo = join(tempRoot, "repo");
    const configPath = join(tempRoot, "config.json");
    initRepo(configuredRepo);
    initRepo(foreignRepo);
    commitFile(configuredRepo, "README.md", "configured\n", "configured");
    commitFile(foreignRepo, "README.md", "foreign\n", "foreign");
    saveRepoProject(configPath, "p1", configuredRepo);

    const result = await handleConfigRpcRequest("project/git/status", {
      projectId: "p1",
      cwd: foreignRepo.replace(/\\/g, "/"),
    }, repoContext(configPath)) as { ok: boolean; message: string };

    assert.equal(result.ok, false);
    assert.equal(result.message, "Working directory is not part of this project");
  },
);

test("config RPC rejects git commit requests for another project's worktree", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];

  const result = await handleConfigRpcRequest("project/git/commit", {
    projectId: "p1",
    cwd: "D:/repo-two",
    message: "fix：错误提交",
    paths: ["README.md"],
  }, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any) as { ok: boolean; message: string };

  assert.equal(result.ok, false);
  assert.equal(result.message, "Working directory is not part of this project");
});

test("config RPC rejects git discard requests for another project's worktree", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];

  const result = await handleConfigRpcRequest("project/git/discard", {
    projectId: "p1",
    cwd: "D:/repo-two",
    paths: ["file.ts"],
  }, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any) as { ok: boolean; message: string };

  assert.equal(result.ok, false);
  assert.equal(result.message, "Working directory is not part of this project");
});

test("config RPC rejects git graph requests for another project's worktree", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];

  const result = await handleConfigRpcRequest("project/git/graph", {
    projectId: "p1",
    cwd: "D:/repo-two",
  }, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any) as { ok: boolean; message: string };

  assert.equal(result.ok, false);
  assert.equal(result.message, "Working directory is not part of this project");
});

test("config RPC rejects commit detail requests for another project's worktree", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];

  const result = await handleConfigRpcRequest("project/git/commit_detail", {
    projectId: "p1",
    cwd: "D:/repo-two",
    commitHash: "abc1234",
  }, {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any) as { ok: boolean; message: string };

  assert.equal(result.ok, false);
  assert.equal(result.message, "Working directory is not part of this project");
});

test("config RPC git status returns diff details for modified files", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-status-details-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "README.md"), "one\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "README.md"), "one\ntwo\n", "utf8");

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  const result = await handleConfigRpcRequest("project/git/status", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
  }, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    resolveProjectById: (id: string, items: any[]) => items.find((project) => project.id === id),
  } as any) as {
    ok: boolean;
    files: Array<{
      path: string;
      additions?: number;
      deletions?: number;
      patch?: string;
    }>;
  };

  assert.equal(result.ok, true);
  const readme = result.files.find((file) => file.path === "README.md");
  assert.equal(readme?.additions, 1);
  assert.equal(readme?.deletions, 0);
  assert.match(readme?.patch ?? "", /diff --git a\/README\.md b\/README\.md/);
});

test("config RPC git commit includes only selected paths and preserves unrelated staged changes", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-commit-selected-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "selected.txt"), "initial\n", "utf8");
  writeFileSync(join(repoPath, "staged.txt"), "initial\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "selected.txt", "staged.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "initial"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "staged.txt"), "staged change\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "staged.txt"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "selected.txt"), "selected change\n", "utf8");

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  const result = await handleConfigRpcRequest("project/git/commit", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    message: "test：只提交选中文件",
    paths: ["selected.txt"],
  }, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    resolveProjectById: (id: string, items: any[]) => items.find((project) => project.id === id),
  } as any) as { ok: boolean };

  assert.equal(result.ok, true);
  const committedPaths = execFileSync(
    "git",
    ["-C", repoPath, "show", "--pretty=format:", "--name-only", "HEAD"],
    { encoding: "utf8" },
  ).trim().split(/\r?\n/u).filter(Boolean);
  const stagedPaths = execFileSync(
    "git",
    ["-C", repoPath, "diff", "--cached", "--name-only"],
    { encoding: "utf8" },
  ).trim().split(/\r?\n/u).filter(Boolean);

  assert.deepEqual(committedPaths, ["selected.txt"]);
  assert.deepEqual(stagedPaths, ["staged.txt"]);
});

test("config RPC git commit restores the original index when commit fails", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-commit-index-rollback-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  initRepo(repoPath);
  writeFileSync(join(repoPath, "selected.txt"), "initial\n", "utf8");
  writeFileSync(join(repoPath, "staged.txt"), "initial\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "selected.txt", "staged.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "initial"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "staged.txt"), "staged change\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "staged.txt"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "selected.txt"), "selected change\n", "utf8");
  execFileSync("git", ["-C", repoPath, "config", "user.name", ""], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", ""], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", repoPath);

  const result = await handleConfigRpcRequest("project/git/commit", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    message: "test：提交应失败",
    paths: ["selected.txt"],
  }, repoContext(configPath)) as { ok: boolean };

  const stagedPaths = execFileSync(
    "git",
    ["-C", repoPath, "diff", "--cached", "--name-only"],
    { encoding: "utf8" },
  ).trim().split(/\r?\n/u).filter(Boolean);
  assert.equal(result.ok, false);
  assert.deepEqual(stagedPaths, ["staged.txt"]);
});

test("config RPC git discard restores selected paths and preserves other changes", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-discard-selected-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "discard.txt"), "initial\n", "utf8");
  writeFileSync(join(repoPath, "keep.txt"), "initial\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "discard.txt", "keep.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "initial"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "discard.txt"), "staged\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "discard.txt"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "discard.txt"), "worktree\n", "utf8");
  writeFileSync(join(repoPath, "keep.txt"), "keep change\n", "utf8");
  writeFileSync(join(repoPath, "untracked.txt"), "remove me\n", "utf8");
  saveRepoProject(configPath, "p1", repoPath);

  const result = await handleConfigRpcRequest("project/git/discard", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    paths: ["discard.txt", "untracked.txt"],
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(readFileSync(join(repoPath, "discard.txt"), "utf8").replace(/\r\n/gu, "\n"), "initial\n");
  assert.equal(existsSync(join(repoPath, "untracked.txt")), false);
  assert.deepEqual(result.files.map((file: { path: string }) => file.path), ["keep.txt"]);
});

test("config RPC git discard rejects requests without selected paths", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-discard-all-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "tracked.txt"), "initial\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "tracked.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "initial"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "tracked.txt"), "changed\n", "utf8");
  writeFileSync(join(repoPath, "untracked.txt"), "remove me\n", "utf8");
  mkdirSync(join(repoPath, ".worktrees"), { recursive: true });
  writeFileSync(join(repoPath, ".worktrees", "keep.txt"), "keep me\n", "utf8");
  writeFileSync(join(repoPath, ".git", "info", "exclude"), ".worktrees/\n", "utf8");
  saveRepoProject(configPath, "p1", repoPath);

  const result = await handleConfigRpcRequest("project/git/discard", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    all: true,
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, false);
  assert.match(result.message, /selected path/i);
  assert.equal(readFileSync(join(repoPath, "tracked.txt"), "utf8").replace(/\r\n/gu, "\n"), "changed\n");
  assert.equal(existsSync(join(repoPath, "untracked.txt")), true);
  assert.equal(existsSync(join(repoPath, ".worktrees", "keep.txt")), true);
});

test("config RPC git discard rejects managed worktree paths", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-discard-worktree-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");
  const managedFile = join(repoPath, ".worktrees", "feature", "keep.txt");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "tracked.txt"), "initial\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "tracked.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "initial"], { stdio: "ignore" });
  mkdirSync(dirname(managedFile), { recursive: true });
  writeFileSync(managedFile, "keep me\n", "utf8");
  saveRepoProject(configPath, "p1", repoPath);

  const result = await handleConfigRpcRequest("project/git/discard", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    paths: [".worktrees/feature/keep.txt"],
  }, repoContext(configPath)) as { ok: boolean; message: string };

  assert.equal(result.ok, false);
  assert.match(result.message, /worktree/i);
  assert.equal(existsSync(managedFile), true);
});

test("config RPC git graph binds refs only to decorated commits", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-graph-refs-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "README.md"), "one\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "first"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "README.md"), "two\n", "utf8");
  execFileSync("git", ["-C", repoPath, "commit", "-am", "second"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "tag", "v1.0.0"], { stdio: "ignore" });

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  const result = await handleConfigRpcRequest("project/git/graph", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
  }, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    resolveProjectById: (id: string, items: any[]) => items.find((project) => project.id === id),
  } as any) as {
    ok: boolean;
    commits: Array<{ subject: string; refs: Array<{ name: string; kind: string; isCurrent: boolean }> }>;
  };

  assert.equal(result.ok, true);
  const headCommit = result.commits.find((commit) => commit.subject === "second");
  const olderCommit = result.commits.find((commit) => commit.subject === "first");

  assert.equal(headCommit?.refs.some((ref) => ref.name === "main" && ref.isCurrent), true);
  assert.equal(headCommit?.refs.some((ref) => ref.name === "v1.0.0" && ref.kind === "tag"), true);
  assert.equal(olderCommit?.refs.some((ref) => ref.name === "HEAD"), false);
});

test("config RPC git graph limits the initial history payload to 60 commits", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-graph-full-history-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  for (let index = 1; index <= 61; index += 1) {
    execFileSync(
      "git",
      ["-C", repoPath, "commit", "--allow-empty", "-m", `commit ${index}`],
      { stdio: "ignore" },
    );
  }

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  const result = await handleConfigRpcRequest("project/git/graph", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
  }, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    resolveProjectById: (id: string, items: any[]) => items.find((project) => project.id === id),
  } as any) as {
    ok: boolean;
    commits: Array<{ subject: string }>;
  };

  assert.equal(result.ok, true);
  assert.equal(result.commits.length, 60);
  assert.equal(result.commits.at(-1)?.subject, "commit 2");
});

test("config RPC returns file patches for a selected commit", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-commit-detail-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "README.md"), "one\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "first"], { stdio: "ignore" });

  writeFileSync(join(repoPath, "README.md"), "one\ntwo\n", "utf8");
  writeFileSync(join(repoPath, "new.txt"), "new\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "."], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "second"], { stdio: "ignore" });
  const commitHash = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  execFileSync("git", ["-C", repoPath, "checkout", "-b", "feature"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "feature.txt"), "feature\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "feature.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "feature"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "checkout", "main"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "main.txt"), "main\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "main.txt"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "merge", "--no-ff", "feature", "-m", "merge feature"], {
    stdio: "ignore",
  });
  const mergeHash = execFileSync("git", ["-C", repoPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  const context = {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    resolveProjectById: (id: string, items: any[]) => items.find((project) => project.id === id),
  } as any;
  const result = await handleConfigRpcRequest("project/git/commit_detail", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    commitHash,
  }, context) as {
    ok: boolean;
    commitHash: string;
    files: Array<{ path: string; status: string; additions: number; deletions: number; patch?: string }>;
  };

  assert.equal(result.ok, true);
  assert.equal(result.commitHash, commitHash);
  const readme = result.files.find((file) => file.path === "README.md");
  const added = result.files.find((file) => file.path === "new.txt");
  assert.equal(readme?.status, "modified");
  assert.equal(readme?.additions, 1);
  assert.match(readme?.patch ?? "", /\+two/);
  assert.equal(added?.status, "added");
  assert.equal(added?.additions, 1);

  const mergeResult = await handleConfigRpcRequest("project/git/commit_detail", {
    projectId: "p1",
    cwd: repoPath.replace(/\\/g, "/"),
    commitHash: mergeHash,
  }, context) as { ok: boolean; files: Array<{ path: string; status: string }> };
  assert.equal(mergeResult.ok, true);
  assert.equal(mergeResult.files.some((file) => file.path === "feature.txt"), true);
});

test("config RPC list worktrees discovers external git worktrees", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-worktree-discover-"));
  const repoPath = join(tempRoot, "repo");
  const worktreePath = join(repoPath, ".worktrees", "test-worktree");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "README.md"), "test\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "test-worktree", worktreePath], { stdio: "ignore" });

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  let cachedProjects: any[] = [];
  let cachedWorktrees: any[] = [];
  const context = {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    setProjects: (items: any[]) => {
      cachedProjects = items;
    },
    setWorktrees: (items: any[]) => {
      cachedWorktrees = items;
    },
    getProjects: () => cachedProjects,
    resolveProjectById: (id: string, projects: any[]) => projects.find((project) => project.id === id),
  } as any;

  const result = await handleConfigRpcRequest(
    "project/list_worktrees",
    { projectId: "p1" },
    context,
  ) as { worktrees: Array<{ path: string }> };

  const discoveredPath = worktreePath.replace(/\\/g, "/");
  const savedProject = readProjectYaml("p1", configPath);
  assert.equal(result.worktrees.some((worktree) => worktree.path === discoveredPath), true);
  assert.equal(savedProject.worktrees?.some((worktree) => worktree.path === discoveredPath), true);
  assert.equal(cachedWorktrees.some((worktree) => worktree.path === discoveredPath), true);
});

test("config RPC create worktree preserves the linked worktree kind after reload", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-create-worktree-kind-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");
  initRepo(repoPath);
  commitFile(repoPath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", repoPath, "branch", "feature"], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", repoPath);

  const baseContext = repoContext(configPath);
  const result = await handleConfigRpcRequest("project/git/create_worktree", {
    projectId: "p1",
    branchName: "feature",
  }, {
    ...baseContext,
    setProjects: () => undefined,
    setWorktrees: () => undefined,
  }) as { ok: boolean; selectedCwd?: string };

  assert.equal(result.ok, true);
  const savedProject = readProjectYaml("p1", configPath);
  const savedWorktree = savedProject.worktrees?.find(
    (worktree) => worktree.path === result.selectedCwd,
  );
  assert.equal(savedWorktree?.branch, "feature");
  assert.equal(savedWorktree?.kind, "git-worktree");
  const mainStatus = execFileSync(
    "git",
    ["-C", repoPath, "status", "--porcelain=v1"],
    { encoding: "utf8" },
  );
  assert.equal(mainStatus.trim(), "");
});

test("config RPC list projects discovers external git worktrees", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-project-worktree-discover-"));
  const repoPath = join(tempRoot, "repo");
  const worktreePath = join(repoPath, ".worktrees", "test-worktree");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "README.md"), "test\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "test-worktree", worktreePath], { stdio: "ignore" });

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );

  let cachedProjects: any[] = [];
  let cachedWorktrees: any[] = [];
  const result = await handleConfigRpcRequest("project/list", {}, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    setProjects: (items: any[]) => {
      cachedProjects = items;
    },
    setWorktrees: (items: any[]) => {
      cachedWorktrees = items;
    },
    logError: () => undefined,
  } as any) as { projects: Array<{ worktrees?: Array<{ path: string }> }> };

  const discoveredPath = worktreePath.replace(/\\/g, "/");
  assert.equal(result.projects[0]?.worktrees?.some((worktree) => worktree.path === discoveredPath), true);
  assert.equal(
    cachedProjects[0]?.worktrees?.some((worktree: { path: string }) => worktree.path === discoveredPath),
    true,
  );
  assert.equal(cachedWorktrees.some((worktree: { path: string }) => worktree.path === discoveredPath), true);
  assert.equal(
    readProjectYaml("p1", configPath).worktrees?.some((worktree: { path: string }) => worktree.path === discoveredPath),
    true,
  );
});

test("config RPC list projects refreshes the root worktree branch", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-project-list-git-"));
  const repoPath = join(tempRoot, "repo");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "README.md"), "test\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "checkout", "-b", "feature"], { stdio: "ignore" });

  writeFileSync(
    configPath,
    JSON.stringify({
      helms: [],
      projects: [
        {
          id: "p1",
          name: "Project",
          helmId: "local",
          path: repoPath.replace(/\\/g, "/"),
          cwds: ["main"],
          defaultCwd: "main",
          gitBranches: ["main"],
          gitCurrentBranch: "main",
        },
      ],
      worktrees: [{ id: "main", name: "main", path: repoPath.replace(/\\/g, "/") }],
      agents: [],
    }),
    "utf8",
  );

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      gitBranches: ["main"],
      gitCurrentBranch: "main",
      worktrees: [{ name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" }],
    },
    configPath,
  );

  let cachedProjects: any[] = [];
  const readConfig = () => JSON.parse(readFileSync(configPath, "utf8"));
  const result = await handleConfigRpcRequest("project/list", {}, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    setProjects: (items: any[]) => {
      cachedProjects = items;
    },
    logError: () => undefined,
  } as any) as { projects: Array<{ gitCurrentBranch?: string; defaultCwd?: string }> };

  assert.equal(result.projects[0]?.gitCurrentBranch, "feature");
  assert.equal(cachedProjects[0]?.gitCurrentBranch, "feature");
  assert.equal(readProjectYaml("p1", configPath).worktrees?.some((worktree: any) => worktree.branch === "feature"), true);
});

test("config RPC lists ACP connection inventory", async () => {
  const connections = [{ providerId: "codex", cwd: "main", status: "ready" }];

  const result = await handleConfigRpcRequest("agent/connections", {}, {
    listAcpConnectionInventory: () => connections,
  } as any);

  assert.deepEqual(result, { connections });
});



test("config RPC connects an agent provider without creating a session", async () => {
  let connectCalled = false;
  const provider = { id: "codex", name: "Codex", command: "codex-acp" };
  const worktree = { id: "main", name: "main", path: "D:/repo" };

  const result = await handleConfigRpcRequest(
    "agent/connect",
    { providerId: "codex", cwd: "D:/repo" },
    {
      getAgents: () => [provider],
      getWorktrees: () => [worktree],
      getProjects: () => [],
      resolveProviderById: (id: string) => (id === "codex" ? provider : undefined),
      connectAcpConnection: async () => {
        connectCalled = true;
        return {
          inventory: () => ({ runtimeConnectionId: "conn-connect" }),
        };
      },
      listAcpConnectionInventory: () => [{ runtimeConnectionId: "conn-connect" }],
      logInfo: () => undefined,
      logError: () => undefined,
    } as any,
  );

  assert.equal(connectCalled, true);
  assert.deepEqual(result, {
    ok: true,
    providerId: "codex",
    cwd: "D:/repo",
    runtimeConnectionId: "conn-connect",
    connection: { runtimeConnectionId: "conn-connect" },
    connections: [{ runtimeConnectionId: "conn-connect" }],
    message: "ACP provider connected.",
  });
});


test("config RPC reconnects an agent provider without prewarming a session", async () => {
  let reconnectCalled = false;
  const provider = { id: "codex", name: "Codex", command: "codex-acp" };
  const worktree = { id: "main", name: "main", path: "D:/repo" };
  const result = await handleConfigRpcRequest(
    "agent/reconnect",
    { providerId: "codex", cwd: "D:/repo" },
    {
      getAgents: () => [provider],
      getWorktrees: () => [worktree],
      getProjects: () => [],
      resolveProviderById: (id: string) => (id === "codex" ? provider : undefined),
      reconnectAcpConnection: async () => {
        reconnectCalled = true;
        return {
          inventory: () => ({ runtimeConnectionId: "conn-1" }),
        };
      },
      listAcpConnectionInventory: () => [{ runtimeConnectionId: "conn-1" }],
      logInfo: () => undefined,
      logError: () => undefined,
    } as any,
  );

  assert.equal(reconnectCalled, true);
  assert.deepEqual(result, {
    ok: true,
    providerId: "codex",
    cwd: "D:/repo",
    runtimeConnectionId: "conn-1",
    connection: { runtimeConnectionId: "conn-1" },
    connections: [{ runtimeConnectionId: "conn-1" }],
    message: "ACP provider reconnected.",
  });
});

test("ensureTillerConfigDefaults creates daemon auth config when file is missing", () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");

  const result = ensureTillerConfigDefaults(configPath);
  const saved = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(result.updated, true);
  assert.deepEqual(saved, {
    daemon: {
      host: "127.0.0.1",
      port: 47631,
      auth: "none",
    },
  });
});

test("ensureTillerConfigDefaults adds missing daemon auth without changing endpoint", () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      daemon: { host: "0.0.0.0", port: 47631 },
      projects: [{ id: "p1", name: "Project", helmId: "local" }],
    }),
  );

  const result = ensureTillerConfigDefaults(configPath);
  const saved = JSON.parse(readFileSync(configPath, "utf8"));

  assert.equal(result.updated, true);
  assert.deepEqual(saved.daemon, {
    host: "0.0.0.0",
    port: 47631,
    auth: "none",
  });
  assert.equal(saved.projects, undefined);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).workspaces, undefined);
});

test("config RPC save helm creates daemon auth config field", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  const helm = { id: "local", name: "Local", host: "0.0.0.0", port: 47631 };

  const result = await handleConfigRpcRequest("helm/save", { helm }, {
    configPath,
    loadAvailableHelms: () => [helm],
    loadAvailableProjectsWithSemanticSummaries: async () => [],
    setHelms: () => undefined,
    setProjects: () => undefined,
  } as any);

  const saved = JSON.parse(readFileSync(configPath, "utf8"));

  assert.deepEqual(result, {
    ok: true,
    helmId: "local",
    message: `Saved Helm model config to ${configPath}`,
  });
  assert.deepEqual(saved.daemon, {
    host: "127.0.0.1",
    port: 47631,
    auth: "none",
  });
});

test("config RPC gets and saves logging level with live logger update", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ logging: { level: "warn", format: "pretty", acpTrace: "summary" } }),
    "utf8",
  );
  const appliedLevels: string[] = [];

  const getResult = await handleConfigRpcRequest("logging/get", {}, {
    configPath,
    logger: {
      getLevel: () => "warn",
    },
  } as any) as { logging: { level: string; format: string; acpTrace: string } };

  assert.deepEqual(getResult.logging, {
    level: "warn",
    format: "pretty",
    acpTrace: "summary",
  });

  const saveResult = await handleConfigRpcRequest("logging/save", {
    logging: { level: "debug" },
  }, {
    configPath,
    logger: {
      getLevel: () => "warn",
      setLevel(level: string) {
        appliedLevels.push(level);
      },
    },
  } as any) as { ok: boolean; logging: { level: string; format: string; acpTrace: string } };

  const saved = JSON.parse(readFileSync(configPath, "utf8"));
  assert.equal(saveResult.ok, true);
  assert.deepEqual(saveResult.logging, {
    level: "debug",
    format: "pretty",
    acpTrace: "summary",
  });
  assert.equal(saved.logging.level, "debug");
  assert.deepEqual(appliedLevels, ["debug"]);
});

test("config RPC reports live logger level after runtime logging changes", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ logging: { level: "trace", format: "pretty", acpTrace: "summary" } }),
    "utf8",
  );

  const getResult = await handleConfigRpcRequest("logging/get", {}, {
    configPath,
    logger: {
      getLevel: () => "debug",
    },
  } as any) as { logging: { level: string; format: string; acpTrace: string } };

  assert.deepEqual(getResult.logging, {
    level: "debug",
    format: "pretty",
    acpTrace: "summary",
  });
});

test("config RPC prunes deleted git worktree worktrees", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-worktree-prune-"));
  const repoPath = join(tempRoot, "repo");
  const worktreePath = join(tempRoot, "repo-feature");
  const configPath = join(tempRoot, "config.json");

  execFileSync("git", ["init", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
  writeFileSync(join(repoPath, "README.md"), "test\n", "utf8");
  execFileSync("git", ["-C", repoPath, "add", "README.md"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "worktree", "add", "-b", "feature", worktreePath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "worktree", "remove", worktreePath], { stdio: "ignore" });

  writeFileSync(
    configPath,
    JSON.stringify({
      helms: [],
      projects: [
        {
          id: "p1",
          name: "Project",
          helmId: "local",
          cwds: ["p1-main", "p1-worktree-feature"],
          defaultCwd: "p1-main",
        },
      ],
      worktrees: [
        { id: "p1-main", name: "main", path: repoPath.replace(/\\/g, "/") },
        { id: "p1-worktree-feature", name: "feature", path: worktreePath.replace(/\\/g, "/") },
      ],
      agents: [],
    }),
    "utf8",
  );

  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
        { name: "feature", path: worktreePath.replace(/\\/g, "/"), branch: "feature", kind: "git-worktree" },
      ],
    },
    configPath,
  );

  let cachedProjects: any[] = [];
  let cachedWorktrees: any[] = [];
  const context = {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    setProjects: (items: any[]) => {
      cachedProjects = items;
    },
    setWorktrees: (items: any[]) => {
      cachedWorktrees = items;
    },
    getProjects: () => cachedProjects,
    resolveProjectById: (id: string, projects: any[]) => projects.find((project) => project.id === id),
  } as any;

  const result = await handleConfigRpcRequest(
    "project/git/list_branches",
    { projectId: "p1" },
    context,
  ) as { worktrees: Array<{ path: string }> };

  const savedProject = readProjectYaml("p1", configPath);
  const deletedPath = worktreePath.replace(/\\/g, "/");
  assert.equal(result.worktrees.some((worktree) => worktree.path === deletedPath), false);
  assert.equal(savedProject.worktrees?.some((worktree) => worktree.path === deletedPath), false);
  assert.equal(savedProject.worktrees?.some((worktree) => worktree.path === repoPath.replace(/\\/g, "/")), true);
  assert.equal(cachedWorktrees.some((worktree) => worktree.path === deletedPath), false);
});

test("config RPC deletes a project and its configured worktrees", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      helms: [],
      projects: [
        {
          id: "p1",
          name: "Project",
          helmId: "local",
          cwds: ["w1"],
          defaultCwd: "w1",
        },
      ],
      worktrees: [
        { id: "w1", name: "main", path: "D:/repo" },
        { id: "w2", name: "keep", path: "D:/keep" },
      ],
      agents: [],
    }),
  );
  saveProjectYaml(
    {
      id: "p1",
      name: "Project",
      helmId: "local",
      path: "D:/repo",
      worktrees: [{ name: "main", path: "D:/repo" }],
    },
    configPath,
  );
  let cachedProjects: unknown[] = [];
  let cachedWorktrees: unknown[] = [];

  const result = await handleConfigRpcRequest("project/delete", { projectId: "p1" }, {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [],
    loadAvailableWorktrees: () => [{ id: "w2", name: "keep", path: "D:/keep" }],
    setProjects: (items: unknown[]) => {
      cachedProjects = items;
    },
    setWorktrees: (items: unknown[]) => {
      cachedWorktrees = items;
    },
  } as any);

  assert.deepEqual(result, {
    ok: true,
    projectId: "p1",
    message: `Deleted project from ${join(dirname(configPath), "projects", "p1", "project.yaml")}`,
  });
  assert.deepEqual(cachedProjects, []);
  assert.deepEqual(cachedWorktrees, [{ id: "w2", name: "keep", path: "D:/keep" }]);
});

test("config RPC deletes an agent without mutating projects", async () => {
  const configPath = join(mkdtempSync(join(tmpdir(), "tiller-config-")), "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      helms: [],
      projects: [{ id: "p1", name: "Project", helmId: "local" }],
      worktrees: [],
      agents: [
        { id: "codex", name: "Codex", command: "codex", transport: "stdio", protocol: "acp" },
        { id: "keep", name: "Keep", command: "keep", transport: "stdio", protocol: "acp" },
      ],
    }),
  );
  let cachedAgents: unknown[] = [];
  let cachedProjects: unknown[] = [];

  const result = await handleConfigRpcRequest("agent/delete", { providerId: "codex" }, {
    configPath,
    loadAvailableAgents: () => [
      { id: "keep", name: "Keep", command: "keep", transport: "stdio", protocol: "acp" },
    ],
    loadAvailableProjectsWithSemanticSummaries: async () => [
      { id: "p1", name: "Project", helmId: "local" },
    ],
    setAgents: (items: unknown[]) => {
      cachedAgents = items;
    },
    setProjects: (items: unknown[]) => {
      cachedProjects = items;
    },
  } as any);

  assert.deepEqual(result, {
    ok: true,
    providerId: "codex",
    message: `Deleted provider from ${configPath}`,
  });
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).agents.map((agent: any) => agent.id), [
    "keep",
  ]);
  assert.deepEqual(cachedAgents.map((agent: any) => agent.id), ["keep"]);
  assert.deepEqual(cachedProjects, [{ id: "p1", name: "Project", helmId: "local" }]);
});

test("config RPC schedules explicit daemon shutdown", async () => {
  const shutdownReasons: string[] = [];

  const result = await handleConfigRpcRequest("daemon/shutdown", {}, {
    requestShutdown: (reason: string) => {
      shutdownReasons.push(reason);
    },
  } as any);

  assert.deepEqual(result, {
    ok: true,
    message: "Helm shutdown requested.",
  });
  assert.deepEqual(shutdownReasons, ["rpc"]);
});

function initRepo(repoPath: string) {
  execFileSync("git", ["init", "--initial-branch", "main", repoPath], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.email", "tiller@example.test"], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "config", "user.name", "Tiller Test"], { stdio: "ignore" });
}

function commitFile(repoPath: string, name: string, content: string, msg: string) {
  writeFileSync(join(repoPath, name), content, "utf8");
  execFileSync("git", ["-C", repoPath, "add", "--", name], { stdio: "ignore" });
  execFileSync("git", ["-C", repoPath, "commit", "-m", msg], { stdio: "ignore" });
}

function saveRepoProject(configPath: string, projectId: string, repoPath: string) {
  saveProjectYaml(
    {
      id: projectId,
      name: "Project",
      helmId: "local",
      path: repoPath.replace(/\\/g, "/"),
      worktrees: [
        { name: "main", path: repoPath.replace(/\\/g, "/"), branch: "main", kind: "root" },
      ],
    },
    configPath,
  );
}

function repoContext(configPath: string) {
  return {
    configPath,
    loadAvailableProjectsWithSemanticSummaries: async () => [readProjectYaml("p1", configPath)],
    loadAvailableWorktrees: () => readProjectYaml("p1", configPath).worktrees ?? [],
    resolveProjectById: (id: string, items: any[]) =>
      items.find((project) => project.id === id),
  } as any;
}

function setupRemoteClone(tempRoot: string) {
  const barePath = join(tempRoot, "remote.git");
  const clonePath = join(tempRoot, "clone");
  execFileSync("git", ["init", "--bare", "--initial-branch", "main", barePath], { stdio: "ignore" });
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", clonePath, "remote", "add", "origin", barePath], { stdio: "ignore" });
  execFileSync("git", ["-C", clonePath, "push", "-u", "origin", "main"], { stdio: "ignore" });
  return { barePath, clonePath };
}

function makeSecondClone(tempRoot: string, barePath: string) {
  const otherClone = join(tempRoot, "other");
  execFileSync("git", ["clone", "--branch", "main", barePath, otherClone], { stdio: "ignore" });
  return otherClone;
}

test("config RPC git status reports upstream tracking state", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-track-"));
  const configPath = join(tempRoot, "config.json");
  const { clonePath } = setupRemoteClone(tempRoot);
  commitFile(clonePath, "README.md", "two\n", "second");
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/status", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
    refreshRemote: true,
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(result.detached, false);
  assert.equal(result.upstreamBranch, "origin/main");
  assert.equal(result.ahead, 1);
  assert.equal(result.behind, 0);
  assert.equal(result.trackingStale, false);
  assert.equal(result.pushTarget, "origin/main");
});

test("config RPC git status zeroes tracking on detached HEAD", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-detached-"));
  const clonePath = join(tempRoot, "clone");
  const configPath = join(tempRoot, "config.json");
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", clonePath, "checkout", "--detach", "HEAD"], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/status", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(result.detached, true);
  assert.equal(result.upstreamBranch, undefined);
  assert.equal(result.ahead, 0);
  assert.equal(result.behind, 0);
  assert.equal(result.trackingStale, false);
  assert.match(result.branch ?? "", /^[0-9a-f]{7,40}$/);
});

test("config RPC git status reports stale tracking on fetch failure", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-stale-"));
  const clonePath = join(tempRoot, "clone");
  const configPath = join(tempRoot, "config.json");
  const barePath = join(tempRoot, "remote.git");
  execFileSync("git", ["init", "--bare", barePath], { stdio: "ignore" });
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", clonePath, "remote", "add", "origin", barePath], { stdio: "ignore" });
  execFileSync("git", ["-C", clonePath, "push", "-u", "origin", "main"], { stdio: "ignore" });
  // Now replace remote with a missing path to cause fetch failure.
  execFileSync("git", ["-C", clonePath, "remote", "set-url", "origin", join(tempRoot, "missing.git")], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/status", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
    refreshRemote: true,
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(result.trackingStale, true);
  assert.ok(result.remoteRefreshError);
  assert.equal(result.branch, "main");
});

test("config RPC git commit failure returns the current tracking snapshot", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-commit-failure-"));
  const configPath = join(tempRoot, "config.json");
  const { clonePath } = setupRemoteClone(tempRoot);
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/commit", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
    message: "missing file",
    paths: ["missing.txt"],
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, false);
  assert.equal(result.branch, "main");
  assert.equal(result.detached, false);
  assert.equal(result.upstreamBranch, "origin/main");
  assert.equal(result.pushTarget, "origin/main");
  assert.equal(result.ahead, 0);
  assert.equal(result.behind, 0);
  assert.equal(result.commitHash, undefined);
});

test("config RPC git push pushes when upstream exists", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-push-upstream-"));
  const configPath = join(tempRoot, "config.json");
  const { barePath, clonePath } = setupRemoteClone(tempRoot);
  commitFile(clonePath, "README.md", "two\n", "second");
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/push", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(result.upstreamBranch, "origin/main");
  assert.equal(result.pushTarget, "origin/main");

  const remoteLog = execFileSync("git", ["-C", barePath, "log", "--format=%s", "main"], { encoding: "utf8" });
  assert.match(remoteLog, /second/);
});

test("config RPC git push publishes to origin when no upstream", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-push-publish-"));
  const configPath = join(tempRoot, "config.json");
  const barePath = join(tempRoot, "remote.git");
  const clonePath = join(tempRoot, "clone");
  execFileSync("git", ["init", "--bare", barePath], { stdio: "ignore" });
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", clonePath, "remote", "add", "origin", barePath], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", clonePath);

  const statusBefore = await handleConfigRpcRequest("project/git/status", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;
  assert.equal(statusBefore.pushTarget, "origin/main");

  const result = await handleConfigRpcRequest("project/git/push", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(result.upstreamBranch, "origin/main");
  assert.equal(result.pushTarget, "origin/main");

  const remoteLog = execFileSync("git", ["-C", barePath, "log", "--format=%s", "main"], { encoding: "utf8" });
  assert.match(remoteLog, /init/);
});

test("config RPC git push rejects when multiple remotes and no origin", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-push-multi-"));
  const configPath = join(tempRoot, "config.json");
  const bareA = join(tempRoot, "a.git");
  const bareB = join(tempRoot, "b.git");
  const clonePath = join(tempRoot, "clone");
  execFileSync("git", ["init", "--bare", bareA], { stdio: "ignore" });
  execFileSync("git", ["init", "--bare", bareB], { stdio: "ignore" });
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", clonePath, "remote", "add", "alpha", bareA], { stdio: "ignore" });
  execFileSync("git", ["-C", clonePath, "remote", "add", "beta", bareB], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/push", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /origin|remote/i);
});

test("config RPC git pull rejects dirty worktree", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-pull-dirty-"));
  const configPath = join(tempRoot, "config.json");
  const { barePath, clonePath } = setupRemoteClone(tempRoot);
  const otherClone = makeSecondClone(tempRoot, barePath);
  commitFile(otherClone, "README.md", "two\n", "second");
  execFileSync("git", ["-C", otherClone, "push", "origin", "main"], { stdio: "ignore" });
  writeFileSync(join(clonePath, "README.md"), "dirty\n", "utf8");
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/pull", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /dirty|clean/i);
});

test("config RPC git pull fast-forwards behind commits", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-pull-ff-"));
  const configPath = join(tempRoot, "config.json");
  const { barePath, clonePath } = setupRemoteClone(tempRoot);
  const otherClone = makeSecondClone(tempRoot, barePath);
  commitFile(otherClone, "README.md", "two\n", "second");
  execFileSync("git", ["-C", otherClone, "push", "origin", "main"], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/pull", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, true);
  assert.equal(result.behind, 0);
});

test("config RPC git pull rejects when no upstream", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-pull-noupstream-"));
  const clonePath = join(tempRoot, "clone");
  const configPath = join(tempRoot, "config.json");
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  saveRepoProject(configPath, "p1", clonePath);

  const result = await handleConfigRpcRequest("project/git/pull", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;

  assert.equal(result.ok, false);
  assert.match(result.message ?? "", /upstream/i);
});

test("config RPC rejects push and pull on detached HEAD", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-detached-push-"));
  const clonePath = join(tempRoot, "clone");
  const configPath = join(tempRoot, "config.json");
  initRepo(clonePath);
  commitFile(clonePath, "README.md", "one\n", "init");
  execFileSync("git", ["-C", clonePath, "checkout", "--detach", "HEAD"], { stdio: "ignore" });
  saveRepoProject(configPath, "p1", clonePath);

  const push = await handleConfigRpcRequest("project/git/push", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;
  assert.equal(push.ok, false);

  const pull = await handleConfigRpcRequest("project/git/pull", {
    projectId: "p1",
    cwd: clonePath.replace(/\\/g, "/"),
  }, repoContext(configPath)) as any;
  assert.equal(pull.ok, false);
});

test("config RPC git push and pull reject foreign cwd", async () => {
  const projects = [
    {
      id: "p1",
      name: "Project One",
      helmId: "local",
      path: "D:/repo-one",
      worktrees: [{ name: "main", path: "D:/repo-one", branch: "main", kind: "root" }],
    },
    {
      id: "p2",
      name: "Project Two",
      helmId: "local",
      path: "D:/repo-two",
      worktrees: [{ name: "main", path: "D:/repo-two", branch: "main", kind: "root" }],
    },
  ];
  const ctx = {
    loadAvailableProjectsWithSemanticSummaries: async () => projects,
    loadAvailableWorktrees: () => projects.flatMap((project) => project.worktrees),
    resolveProjectById: (id: string, items: typeof projects) =>
      items.find((project) => project.id === id),
  } as any;

  const push = await handleConfigRpcRequest("project/git/push", {
    projectId: "p1",
    cwd: "D:/repo-two",
  }, ctx) as { ok: boolean; message: string };
  assert.equal(push.ok, false);
  assert.equal(push.message, "Working directory is not part of this project");

  const pull = await handleConfigRpcRequest("project/git/pull", {
    projectId: "p1",
    cwd: "D:/repo-two",
  }, ctx) as { ok: boolean; message: string };
  assert.equal(pull.ok, false);
  assert.equal(pull.message, "Working directory is not part of this project");
});

test("config RPC git status dedupes identical refresh requests but not across refreshRemote", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-dedupe-"));
  const configPath = join(tempRoot, "config.json");
  const { clonePath } = setupRemoteClone(tempRoot);
  saveRepoProject(configPath, "p1", clonePath);
  const ctx = repoContext(configPath);
  const cwd = clonePath.replace(/\\/g, "/");

  const a = handleConfigRpcRequest("project/git/status", { projectId: "p1", cwd, refreshRemote: true }, ctx);
  const b = handleConfigRpcRequest("project/git/status", { projectId: "p1", cwd, refreshRemote: true }, ctx);
  assert.equal(await a, await b);

  const c = await handleConfigRpcRequest("project/git/status", { projectId: "p1", cwd, refreshRemote: false }, ctx) as any;
  assert.equal(c.ok, true);
});

test("config RPC does not dedupe commit requests with different messages or paths", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-commit-dedupe-"));
  const configPath = join(tempRoot, "config.json");
  const { clonePath } = setupRemoteClone(tempRoot);
  writeFileSync(join(clonePath, "a.txt"), "a\n", "utf8");
  writeFileSync(join(clonePath, "b.txt"), "b\n", "utf8");
  saveRepoProject(configPath, "p1", clonePath);
  const ctx = repoContext(configPath);
  const cwd = clonePath.replace(/\\/g, "/");

  const [first, second] = await Promise.all([
    handleConfigRpcRequest("project/git/commit", {
      projectId: "p1",
      cwd,
      message: "commit a",
      paths: ["a.txt"],
    }, ctx) as Promise<any>,
    handleConfigRpcRequest("project/git/commit", {
      projectId: "p1",
      cwd,
      message: "commit b",
      paths: ["b.txt"],
    }, ctx) as Promise<any>,
  ]);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.commitHash, second.commitHash);

  const log = execFileSync("git", ["-C", clonePath, "log", "-2", "--format=%s"], { encoding: "utf8" });
  assert.match(log, /commit a/);
  assert.match(log, /commit b/);
});

test("config RPC serializes push and status against the same git root", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "tiller-git-queue-"));
  const configPath = join(tempRoot, "config.json");
  const { clonePath } = setupRemoteClone(tempRoot);
  saveRepoProject(configPath, "p1", clonePath);
  const ctx = repoContext(configPath);
  const cwd = clonePath.replace(/\\/g, "/");

  // Fire push and status concurrently; both must resolve without error.
  // The per-git-root queue serializes them, so no concurrent ref writes occur.
  const [pushResult, statusResult] = await Promise.all([
    handleConfigRpcRequest("project/git/push", { projectId: "p1", cwd }, ctx) as Promise<any>,
    handleConfigRpcRequest("project/git/status", { projectId: "p1", cwd, refreshRemote: false }, ctx) as Promise<any>,
  ]);

  assert.equal(pushResult.ok, true);
  assert.equal(statusResult.ok, true);
  // Both operations completed against the same repo root without rejecting.
});
