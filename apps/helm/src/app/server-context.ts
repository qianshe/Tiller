type ContextStateInput<THelm, TWorktree, TAgent, TProject> = {
  helms: THelm[];
  worktrees: TWorktree[];
  agents: TAgent[];
  projects: TProject[];
};

export function createHelmContextState<
  THelm = unknown,
  TWorktree = unknown,
  TAgent = unknown,
  TProject = unknown,
>(input: ContextStateInput<THelm, TWorktree, TAgent, TProject>) {
  let helms = input.helms;
  let worktrees = input.worktrees;
  let agents = input.agents;
  let projects = input.projects;

  return {
    getHelms: () => helms,
    setHelms: (items: THelm[]) => {
      helms = items;
    },
    getWorktrees: () => worktrees,
    setWorktrees: (items: TWorktree[]) => {
      worktrees = items;
    },
    getAgents: () => agents,
    setAgents: (items: TAgent[]) => {
      agents = items;
    },
    getProjects: () => projects,
    setProjects: (items: TProject[]) => {
      projects = items;
    },
  };
}
