type DashboardTaskRpcMethod = "session/new" | "session/prompt";

type DashboardTaskDispatch = (
  method: DashboardTaskRpcMethod,
  params: Record<string, unknown>,
) => Promise<unknown>;

type DashboardTaskPreparationCleanupDispatch = (
  method: "conversation/delete",
  params: Record<string, unknown>,
) => Promise<unknown>;

type LaunchDashboardTaskBaseInput = {
  prompt: string;
  dispatch: DashboardTaskDispatch;
};

type LaunchDashboardTaskInput = LaunchDashboardTaskBaseInput & (
  | {
      projectId: string;
      cwd: string;
      agentId: string;
      sessionId?: never;
    }
  | {
      sessionId: string;
      projectId?: never;
      cwd?: never;
      agentId?: never;
    }
);

export type DashboardTaskLaunchPhase = DashboardTaskRpcMethod;

export class DashboardTaskLaunchError extends Error {
  readonly phase: DashboardTaskLaunchPhase;
  readonly cause: unknown;

  constructor(phase: DashboardTaskLaunchPhase, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "DashboardTaskLaunchError";
    this.phase = phase;
    this.cause = cause;
  }
}

function dashboardTaskSessionId(result: unknown): string | null {
  const sessionId = (result as { session?: { id?: unknown } } | null)?.session?.id;
  return typeof sessionId === "string" && sessionId ? sessionId : null;
}

export async function launchDashboardTask(input: LaunchDashboardTaskInput): Promise<string> {
  const { prompt, dispatch } = input;
  let sessionId = input.sessionId;
  if (!sessionId) {
    let creationResult: unknown;
    try {
      creationResult = await dispatch("session/new", {
        projectId: input.projectId,
        cwd: input.cwd,
        agentId: input.agentId,
      });
    } catch (error) {
      throw new DashboardTaskLaunchError("session/new", error);
    }

    sessionId = dashboardTaskSessionId(creationResult) ?? undefined;
    if (!sessionId) {
      throw new DashboardTaskLaunchError(
        "session/new",
        new Error("目标 Helm 没有返回会话 id。"),
      );
    }
  }

  try {
    await dispatch("session/prompt", {
      sessionId,
      text: prompt,
      content: [{ type: "text", text: prompt }],
    });
  } catch (error) {
    throw new DashboardTaskLaunchError("session/prompt", error);
  }

  return sessionId;
}

export async function finalizeDashboardTaskLaunch({
  mode,
  preparationId,
  revision,
  dispatch,
}: {
  mode: "new" | "reuse";
  preparationId?: string;
  revision?: number;
  dispatch: DashboardTaskPreparationCleanupDispatch;
}) {
  if (mode !== "reuse" || !preparationId) {
    return;
  }

  await dispatch("conversation/delete", {
    id: preparationId,
    ...(revision !== undefined ? { revision } : {}),
  });
}
