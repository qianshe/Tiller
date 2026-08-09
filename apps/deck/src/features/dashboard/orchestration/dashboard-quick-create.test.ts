import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, ProjectSummary, SessionSummary } from "@tiller/shared";
import { buildDashboardQuickCreateProjects } from "./dashboard-quick-create.js";

function agent(id: string, name = id): AcpAgentProvider {
  return {
    id,
    name,
    command: id,
    transport: "stdio",
    protocol: "acp",
  };
}

function project(
  id: string,
  name: string,
  helmId: string,
  path: string,
  branch = "main",
): ProjectSummary {
  return {
    id,
    name,
    helmId,
    path,
    gitBranches: [branch],
    gitCurrentBranch: branch,
    worktrees: [{ name: branch, path, branch, kind: "root" }],
  };
}

function session(
  id: string,
  projectId: string,
  helmId: string,
  cwd: string,
  status: SessionSummary["status"] = "idle",
): SessionSummary {
  return {
    id,
    projectId,
    projectName: projectId,
    helmId,
    cwd,
    worktreeName: "main",
    agentId: "codex",
    agentName: "Codex",
    status,
    title: `会话 ${id}`,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    messageCount: 2,
  };
}

test("quick create keeps project and agent inventories scoped to their Helm", () => {
  const projects = buildDashboardQuickCreateProjects({
    currentHelmKey: "127.0.0.1:47631",
    currentHelm: {
      name: "Local Helm",
      host: "127.0.0.1",
      port: 47631,
    },
    currentProjects: [project("shared", "Tiller", "local", "D:/tiller")],
    currentAgents: [agent("codex", "Codex")],
    daemonProfiles: [{
      id: "remote-profile",
      name: "Build Helm",
      host: "10.0.0.8",
      port: "47631",
    }],
    helmInventories: {
      "10.0.0.8:47631": {
        projects: [project("shared", "Tiller", "remote", "D:/remote-tiller")],
        agents: [agent("opencode", "OpenCode")],
      },
    },
  });

  assert.equal(projects.length, 2);
  assert.deepEqual(
    projects.map((item) => [item.helmKey, item.projectId, item.agents?.map((item) => item.id)]),
    [
      ["127.0.0.1:47631", "shared", ["codex"]],
      ["10.0.0.8:47631", "shared", ["opencode"]],
    ],
  );
  assert.notEqual(projects[0]?.key, projects[1]?.key);
  assert.equal(projects[1]?.cwd, "D:/remote-tiller");
});

test("quick create includes an inventory Helm even when its saved profile is missing", () => {
  const projects = buildDashboardQuickCreateProjects({
    currentHelmKey: "127.0.0.1:47631",
    currentHelm: { name: "Local Helm", host: "127.0.0.1", port: 47631 },
    currentProjects: [],
    currentAgents: [],
    daemonProfiles: [],
    helmInventories: {
      "10.0.0.9:47631": {
        projects: [project("p1", "Sandbox", "remote", "D:/sandbox")],
        agents: [],
      },
    },
  });

  assert.equal(projects[0]?.helmKey, "10.0.0.9:47631");
  assert.equal(projects[0]?.helmName, "10.0.0.9:47631");
  assert.equal(projects[0]?.helmEndpoint, "10.0.0.9:47631");
});

test("quick create ignores malformed Helm summaries without dropping valid projects", () => {
  const projects = buildDashboardQuickCreateProjects({
    currentHelmKey: "127.0.0.1:47631",
    currentHelm: { name: "Local Helm", host: "127.0.0.1", port: 47631 },
    currentProjects: [project("p1", "Tiller", "local", "D:/tiller")],
    currentAgents: [agent("codex", "Codex")],
    daemonProfiles: [],
    helmInventories: {},
  });

  assert.deepEqual(projects.map((item) => item.projectId), ["p1"]);
});

test("quick create treats localhost and 127.0.0.1 as the same Helm endpoint", () => {
  const projects = buildDashboardQuickCreateProjects({
    currentHelmKey: "127.0.0.1:47631",
    currentHelm: { name: "Local Helm", host: "127.0.0.1", port: 47631 },
    currentProjects: [project("tiller", "Tiller", "local", "D:/tiller")],
    currentAgents: [agent("codex", "Codex")],
    daemonProfiles: [{
      id: "localhost-profile",
      name: "Local Helm",
      host: "localhost",
      port: "47631",
    }],
    helmInventories: {
      "localhost:47631": {
        projects: [project("tiller", "Tiller", "local", "D:/tiller")],
        agents: [agent("codex", "Codex")],
      },
    },
  });

  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.helmKey, "127.0.0.1:47631");
});

test("quick create expands Git worktrees and excludes projects without Git", () => {
  const tiller = project("tiller", "Tiller", "local", "D:/tiller");
  tiller.worktrees?.push({
    name: "feature-dashboard",
    path: "D:/tiller/.worktrees/feature-dashboard",
    branch: "feature/dashboard",
    kind: "git-worktree",
  });

  const projects = buildDashboardQuickCreateProjects({
    currentHelmKey: "127.0.0.1:47631",
    currentHelm: { name: "Local Helm", host: "127.0.0.1", port: 47631 },
    currentProjects: [
      tiller,
      {
        id: "notes",
        name: "Notes",
        helmId: "local",
        path: "D:/notes",
        worktrees: [{ name: "notes", path: "D:/notes", kind: "root" }],
      },
    ],
    currentAgents: [agent("codex", "Codex")],
    daemonProfiles: [],
    helmInventories: {},
  });

  assert.deepEqual(
    projects.map((item) => [item.projectId, item.branch, item.cwd]),
    [
      ["tiller", "main", "D:/tiller"],
      ["tiller", "feature/dashboard", "D:/tiller/.worktrees/feature-dashboard"],
    ],
  );
  assert.notEqual(projects[0]?.key, projects[1]?.key);
});

test("quick create exposes only idle sessions from the selected Helm project and worktree", () => {
  const localProject = project("tiller", "Tiller", "local", "D:/tiller");
  localProject.worktrees?.push({
    name: "dashboard",
    path: "D:/tiller/.worktrees/dashboard",
    branch: "feature/dashboard",
    kind: "git-worktree",
  });

  const projects = buildDashboardQuickCreateProjects({
    currentHelmKey: "127.0.0.1:47631",
    currentHelm: { name: "Local Helm", host: "127.0.0.1", port: 47631 },
    currentProjects: [localProject],
    currentAgents: [agent("codex", "Codex")],
    currentSessions: [
      session("root-idle", "tiller", "local", "D:/tiller"),
      session("worktree-stale", "tiller", "local", "D:\\tiller\\.worktrees\\dashboard", "error"),
      session("worktree-running", "tiller", "local", "D:/tiller/.worktrees/dashboard", "running"),
      session("other-project", "other", "local", "D:/tiller/.worktrees/dashboard"),
    ],
    currentStatuses: { "worktree-stale": "idle" },
    daemonProfiles: [{
      id: "remote-profile",
      name: "Build Helm",
      host: "10.0.0.8",
      port: "47631",
    }],
    helmInventories: {
      "10.0.0.8:47631": {
        projects: [project("tiller", "Tiller", "remote", "D:/remote-tiller")],
        agents: [agent("opencode", "OpenCode")],
        sessions: [session("remote-idle", "tiller", "remote", "D:/remote-tiller")],
        statuses: {},
      },
    },
  });

  assert.deepEqual(
    projects.map((item) => [
      item.helmKey,
      item.branch,
      item.idleSessions?.map((candidate) => candidate.id),
    ]),
    [
      ["127.0.0.1:47631", "main", ["root-idle"]],
      ["127.0.0.1:47631", "feature/dashboard", ["worktree-stale"]],
      ["10.0.0.8:47631", "main", ["remote-idle"]],
    ],
  );
});
