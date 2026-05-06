import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import type { AppView } from "../../../shared/utils/routes";

type OverviewPageProps = {
  copy: (typeof UI_COPY)[Locale];
  connection: "connecting" | "connected" | "disconnected";
  activeHelm: HelmSummary | null;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  onNavigate: (view: AppView) => void;
  onOpenSession: (sessionId: string) => void;
  resolveDisplaySessionTitle: (session: SessionSummary) => string;
  formatRelativeTime: (value: string) => string;
};

export function OverviewPage({
  copy,
  connection,
  activeHelm,
  daemonHost,
  daemonPort,
  defaultDaemonHost,
  defaultDaemonPort,
  projects,
  workspaces,
  agents,
  sessions,
  onNavigate,
  onOpenSession,
  resolveDisplaySessionTitle,
  formatRelativeTime,
}: OverviewPageProps) {
  const recentSessions = sessions.slice(0, 5);
  const activeHelmLabel = activeHelm
    ? `${activeHelm.name} · ${activeHelm.host}:${activeHelm.port}`
    : `${daemonHost.trim() || defaultDaemonHost}:${daemonPort.trim() || defaultDaemonPort}`;
  const overviewItems = [
    `Helm · ${activeHelmLabel}`,
    `连接 · ${copy.connection[connection]}`,
    `项目 · ${projects.length}`,
    `工作区 · ${workspaces.length}`,
    `ACP 舰员 · ${agents.length}`,
    `任务 · ${sessions.length}`,
  ];
  const latestSession = recentSessions[0] ?? null;

  return (
    <section className="landing-hero" aria-labelledby="landing-hero-title">
      <div className="landing-hero-content">
        <p className="landing-eyebrow">
          <span aria-hidden="true" />
          AI COMMAND PLATFORM
        </p>
        <h1 id="landing-hero-title">
          Command AI.
          <br />
          Unify Everything.
        </h1>
        <p className="landing-copy">
          Tiller is an AI command platform that unifies ACP agents across your
          infrastructure. As Governor, you orchestrate fleets, assign missions,
          and achieve outcomes at scale.
        </p>
        <div className="landing-actions" aria-label="首页操作">
          <button
            className="primary landing-primary"
            type="button"
            onClick={() => onNavigate("sessions")}
          >
            Start Commanding
            <span aria-hidden="true">›</span>
          </button>
          <button
            className="secondary landing-secondary"
            type="button"
            onClick={() => onNavigate("agents")}
          >
            Explore the Deck
          </button>
        </div>
      </div>

      <aside className="landing-telemetry" aria-label="当前总览">
        <div>
          <p className="landing-telemetry-kicker">Live Helm</p>
          <strong>{activeHelmLabel}</strong>
        </div>
        <div className="landing-telemetry-grid">
          {overviewItems.slice(1).map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
        <div className="landing-telemetry-session">
          <p>Latest Mission</p>
          {latestSession ? (
            <button
              type="button"
              onClick={() => {
                onOpenSession(latestSession.id);
                onNavigate("sessions");
              }}
            >
              <strong>{resolveDisplaySessionTitle(latestSession)}</strong>
              <span>{formatRelativeTime(latestSession.updatedAt)}</span>
            </button>
          ) : (
            <span>还没有任务，先进入任务页创建一个。</span>
          )}
        </div>
      </aside>
    </section>
  );
}
