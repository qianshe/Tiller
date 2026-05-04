import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import { InfoList } from "../../../shared/ui/primitives";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import type { AppView } from "../../../app/routes";

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

  return (
    <section className="stack-gap overview-page">
      <section className="card hero-card">
        <div>
          <p className="eyebrow">{copy.heroEyebrow}</p>
          <h1>Tiller Command Deck</h1>
          <p>{copy.heroBody}</p>
        </div>
        <div className="section-actions">
          <button
            className="primary"
            type="button"
            onClick={() => onNavigate("sessions")}
          >
            进入任务
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => onNavigate("agents")}
          >
            管理舰队
          </button>
        </div>
      </section>
      <section className="card surface-card overview-grid">
        <InfoList title="当前总览" items={overviewItems} empty="暂无总览信息" />
        <div className="info-list">
          <div className="section-head section-head-soft">
            <div>
              <h3>最近任务</h3>
              <p className="muted compact">按 Helm 返回顺序展示最近会话。</p>
            </div>
          </div>
          {recentSessions.length ? (
            <div className="session-list compact-session-list">
              {recentSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="session-row"
                  onClick={() => {
                    onOpenSession(session.id);
                    onNavigate("sessions");
                  }}
                >
                  <strong>{resolveDisplaySessionTitle(session)}</strong>
                  <span>
                    {session.projectName} · {session.agentName}
                  </span>
                  <small>{formatRelativeTime(session.updatedAt)}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">还没有任务，先进入任务页创建一个。</div>
          )}
        </div>
      </section>
    </section>
  );
}
