import type {
  AgentProviderDescriptor,
  ProjectSummary,
  SessionStatus,
  SessionSummary,
} from "@tiller/domain-contracts";

export type SessionLifecycleRuntimeResult = {
  runtimeSessionId?: string;
  sessionConfigState?: unknown;
  sessionConfigOptions?: unknown[];
  sessionModelState?: unknown;
  sessionCapabilities?: unknown;
};

export type CreateSessionLifecycleInput = {
  sessionId: string;
  projectId: string;
  agentId: string;
  cwd: string;
  status?: SessionStatus;
};

export type SessionLifecycleBuildSessionInput<
  Project = ProjectSummary,
  Agent = AgentProviderDescriptor,
  Runtime = SessionLifecycleRuntimeResult,
> = {
  sessionId: string;
  project: Project;
  agent: Agent;
  runtime: Runtime;
  cwd: string;
  timestamp: string;
  status: SessionStatus;
};

export type CreateSessionLifecycleResult<
  Session = SessionSummary,
  Runtime = SessionLifecycleRuntimeResult,
> = {
  session: Session;
  runtime: Runtime;
};

export type SessionLifecycleDependencies<
  Project = ProjectSummary,
  Agent = AgentProviderDescriptor,
  Runtime = SessionLifecycleRuntimeResult,
  Session = SessionSummary,
> = {
  resolveProject(projectId: string): Promise<Project>;
  resolveAgent(agentId: string): Promise<Agent>;
  createRuntime(input: {
    sessionId: string;
    project: Project;
    agent: Agent;
    cwd: string;
  }): Promise<Runtime>;
  buildSession?(input: SessionLifecycleBuildSessionInput<Project, Agent, Runtime>): Session;
  persistSession(session: Session): Promise<void>;
  now?(): Date;
};

export function createSessionLifecycle<
  Project extends ProjectSummary = ProjectSummary,
  Agent extends AgentProviderDescriptor = AgentProviderDescriptor,
  Runtime extends SessionLifecycleRuntimeResult = SessionLifecycleRuntimeResult,
  Session = SessionSummary,
>(dependencies: SessionLifecycleDependencies<Project, Agent, Runtime, Session>) {
  return {
    async createSession(input: CreateSessionLifecycleInput): Promise<CreateSessionLifecycleResult<Session, Runtime>> {
      const project = await dependencies.resolveProject(input.projectId);
      const agent = await dependencies.resolveAgent(input.agentId);
      const runtime = await dependencies.createRuntime({
        sessionId: input.sessionId,
        project,
        agent,
        cwd: input.cwd,
      });
      const timestamp = (dependencies.now?.() ?? new Date()).toISOString();
      const status = input.status ?? "running";
      const session = dependencies.buildSession
        ? dependencies.buildSession({
            sessionId: input.sessionId,
            project,
            agent,
            runtime,
            cwd: input.cwd,
            timestamp,
            status,
          })
        : (createDefaultSessionSummary({
            sessionId: input.sessionId,
            project,
            agent,
            runtime,
            cwd: input.cwd,
            timestamp,
            status,
          }) as Session);

      await dependencies.persistSession(session);

      return { session, runtime };
    },
  };
}

function createDefaultSessionSummary(input: SessionLifecycleBuildSessionInput): SessionSummary {
  return {
    id: input.sessionId,
    projectId: input.project.id,
    projectName: input.project.name,
    helmId: input.project.helmId,
    cwd: input.cwd,
    worktreeName: resolveWorktreeName(input.project, input.cwd),
    agentId: input.agent.id,
    agentName: input.agent.name,
    status: input.status,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    messageCount: 0,
    runtimeSessionId: input.runtime.runtimeSessionId,
  };
}

function resolveWorktreeName(project: ProjectSummary, cwd: string): string {
  return (
    project.worktrees?.find((worktree) => worktree.path === cwd)?.name ??
    project.name
  );
}
