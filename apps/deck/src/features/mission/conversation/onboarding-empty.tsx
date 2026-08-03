import { Icon } from "../../../shared/ui/icon";

export type MissionOnboardingEmptyProps = {
  helmConnected: boolean;
  hasAgents: boolean;
  hasProjects: boolean;
  onNavigateAgents: (tab: "agents" | "projects") => void;
};

/**
 * Desktop empty-state onboarding card for the mission chat pane.
 *
 * Guides a new user through the two prerequisite steps before the first
 * session can be started: configure an ACP agent and add a project path.
 * Both steps are satisfied through the Agents page; this card only renders
 * entry points and completion states — it owns no state of its own.
 *
 * Visibility rules (owned by this component):
 * - helm not connected → show a single-line hint and hide the step list.
 * - both steps complete → render nothing (parent owns the "empty pane" gate).
 */
export function MissionOnboardingEmpty({
  helmConnected,
  hasAgents,
  hasProjects,
  onNavigateAgents,
}: MissionOnboardingEmptyProps) {
  if (hasAgents && hasProjects) {
    return null;
  }

  const agentStepAction = hasAgents ? "已配置，前往调整 →" : "前往舰队 →";
  const projectStepAction = hasProjects ? "已配置，前往调整 →" : "前往舰队 →";

  return (
    <section className="mission-onboarding-empty empty-state mx-auto my-auto w-full max-w-md rounded-lg bg-surface-sunken p-5 text-foreground">
      <div className="mb-3">
        <h2 className="text-section font-semibold">工作台引导</h2>
      </div>
      <p className="mb-4 text-meta text-muted-foreground">
        欢迎来到 Tiller。完成下方两步即可开始任务。
      </p>

      {!helmConnected ? (
        <p className="rounded-md bg-warning/10 px-3 py-2 text-meta text-foreground">
          Helm 未连接，连接后可继续配置。
        </p>
      ) : (
        <div className="grid gap-2">
          <MissionOnboardingStep
            label="配置 ACP Agent"
            done={hasAgents}
            stepNumber={1}
            actionLabel={agentStepAction}
            disabled={false}
            onAction={() => onNavigateAgents("agents")}
          />
          <MissionOnboardingStep
            label="添加项目路径"
            done={hasProjects}
            stepNumber={2}
            actionLabel={projectStepAction}
            disabled={false}
            onAction={() => onNavigateAgents("projects")}
          />
        </div>
      )}

      <p className="mt-4 text-2xs text-muted-foreground/70">
        全部完成后即可在此处新建任务。
      </p>
    </section>
  );
}

function MissionOnboardingStep({
  label,
  done,
  stepNumber,
  actionLabel,
  disabled,
  onAction,
}: {
  label: string;
  done: boolean;
  stepNumber: 1 | 2;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        {done ? (
          <Icon name="check" size={14} className="shrink-0 text-success" />
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-emphasis text-2xs font-medium text-muted-foreground">
            {stepNumber === 1 ? "①" : "②"}
          </span>
        )}
        <span className="min-w-0 truncate text-meta font-medium text-foreground">
          {label}
        </span>
      </div>
      <button
        type="button"
        className="shrink-0 rounded-md px-2.5 py-1 text-meta font-medium text-primary transition hover:bg-primary-soft/15 disabled:cursor-not-allowed disabled:text-muted-foreground/40"
        disabled={disabled}
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </div>
  );
}
