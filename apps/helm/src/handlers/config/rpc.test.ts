import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
