import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import type { AppView } from "../../../shared/utils/routes";
import "./page.css";

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
  const telemetryItems = [
    ...overviewItems,
    latestSession
      ? `最新任务 · ${resolveDisplaySessionTitle(latestSession)} · ${formatRelativeTime(latestSession.updatedAt)}`
      : "最新任务 · 等待创建",
  ];

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
          One Deck.
        </h1>
        <p className="landing-copy">
          Tiller gathers local ACP agents, sessions, worktrees, and review signals
          into one command surface.
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
        <div className="landing-telemetry-head">
          <p className="landing-telemetry-kicker">Live Stream</p>
          <strong>{activeHelmLabel}</strong>
        </div>
        <div className="landing-telemetry-stream" aria-label="实时数据流">
          <div className="landing-telemetry-track">
            {[...telemetryItems, ...telemetryItems].map((item, index) => {
              const isLatest = item.startsWith("最新任务 ·") && latestSession;
              return isLatest ? (
                <button
                  key={`${item}-${index}`}
                  type="button"
                  className="landing-telemetry-line"
                  onClick={() => {
                    onOpenSession(latestSession.id);
                    onNavigate("sessions");
                  }}
                >
                  {item}
                </button>
              ) : (
                <span key={`${item}-${index}`} className="landing-telemetry-line">
                  {item}
                </span>
              );
            })}
          </div>
        </div>
      </aside>
    </section>
  );
}
