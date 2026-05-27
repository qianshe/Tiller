export const emptyInventory = {
  helmList: { helms: [] },
  projectList: { projects: [] },
  agentList: { agents: [] },
  sessionList: { sessions: [], hasMore: false },
};

export const populatedInventory = {
  helmList: {
    helms: [
      {
        id: "proof-helm",
        name: "Language Adapter Proof Helm",
        host: "127.0.0.1",
        port: 0,
      },
    ],
  },
  projectList: {
    projects: [
      {
        id: "proof-project",
        name: "Language Adapter Proof",
        helmId: "proof-helm",
        worktrees: [
          {
            id: "proof-worktree",
            name: "main",
            path: "D:/proof/project",
            branch: "main",
            isDefault: true,
          },
        ],
      },
    ],
  },
  agentList: {
    agents: [
      {
        id: "proof-agent",
        name: "Proof Agent",
        command: "proof-agent",
        args: [],
        transport: "stdio",
        protocol: "acp",
      },
    ],
  },
  sessionList: {
    sessions: [
      {
        id: "proof-session",
        projectId: "proof-project",
        projectName: "Language Adapter Proof",
        helmId: "proof-helm",
        cwd: "D:/proof/project",
        worktreeName: "main",
        agentId: "proof-agent",
        agentName: "Proof Agent",
        status: "idle",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
        messageCount: 0,
      },
    ],
    hasMore: false,
  },
};

export function resolveInventoryFixture(mode = "populated") {
  if (mode === "empty") {
    return emptyInventory;
  }
  return populatedInventory;
}
