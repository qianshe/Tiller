import type {
  AcpAgentProvider,
  HelmSummary,
  ProjectSummary,
  SessionSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { Locale, UI_COPY } from "../../../shared/utils/copy";
import type { AppView } from "../../../shared/utils/routes";
import "./page.css";

const TILLER_REPO_URL = "https://github.com/qianshe/Tiller";

function GithubLink() {
  return (
    <a
      href={TILLER_REPO_URL}
      target="_blank"
      rel="noreferrer noopener"
      className="landing-github-link landing-github-link-desktop"
      aria-label="打开 Tiller GitHub 仓库"
      title="GitHub:qianshe/Tiller"
    >
      <svg viewBox="0 0 24 24" role="img" aria-hidden="true" width="20" height="20">
        <path
          fill="currentColor"
          d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.1.79-.25.79-.56v-2.16c-3.22.7-3.9-1.38-3.9-1.38-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.28-5.27-5.72 0-1.26.45-2.3 1.2-3.1-.12-.3-.52-1.48.11-3.06 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.64 1.58.24 2.77.12 3.06.75.8 1.2 1.84 1.2 3.1 0 4.45-2.71 5.43-5.29 5.71.42.36.79 1.07.79 2.16v3.2c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 .5Z"
        />
      </svg>
    </a>
  );
}

type OverviewPageProps = {
  copy: (typeof UI_COPY)[Locale];
  connection: "connecting" | "connected" | "disconnected";
  activeHelm: HelmSummary | null;
  daemonHost: string;
  daemonPort: string;
  defaultDaemonHost: string;
  defaultDaemonPort: string;
  projects: ProjectSummary[];
  worktrees: WorktreeSummary[];
  agents: AcpAgentProvider[];
  sessions: SessionSummary[];
  onNavigate: (view: AppView) => void;
  onOpenSession: (sessionId: string) => void;
  resolveDisplaySessionTitle: (session: SessionSummary) => string;
  formatRelativeTime: (value: string) => string;
};

export function OverviewPage({
  connection,
  activeHelm,
  daemonHost,
  daemonPort,
  defaultDaemonHost,
  defaultDaemonPort,
  projects,
  sessions,
  onNavigate,
}: OverviewPageProps) {
  const activeHelmLabel = activeHelm
    ? `${activeHelm.name} · ${activeHelm.host}:${activeHelm.port}`
    : `${daemonHost.trim() || defaultDaemonHost}:${daemonPort.trim() || defaultDaemonPort}`;
  const onlineHelmCount = connection === "connected" ? 1 : 0;
  const landingStats = [
    { label: "在线 HELM", value: String(onlineHelmCount), suffix: "台" },
    { label: "项目", value: String(projects.length), suffix: "个" },
    { label: "会话", value: String(sessions.length), suffix: "个" },
  ];

  return (
    <section className="landing-hero" aria-labelledby="landing-hero-title">
      <GithubLink />
      <div className="landing-hero-content">
        <p className="landing-eyebrow">
          <span aria-hidden="true" />
          AI COMMAND PLATFORM
        </p>
        <h1 id="landing-hero-title">
          把本地 AI Agent 代理
          <br />
          整理成一个指挥台
        </h1>
        <p className="landing-copy">
          Tiller 汇聚跑在你电脑、工作站或服务器上的 ACP Agent,把多份任务、工作树和审批信号收拢到同一个浏览器工作台。 运行时在本地,数据保存在自己机器,默认支持局域网。
        </p>
        <div className="landing-actions" aria-label="首页操作">
          <button
            className="landing-primary"
            type="button"
            onClick={() => onNavigate("sessions")}
          >
            进入工作台
            <span aria-hidden="true">›</span>
          </button>
          <button
            className="landing-secondary"
            type="button"
            onClick={() => onNavigate("dashboard")}
          >
            查看 Dashboard
          </button>
        </div>
        <dl className="landing-meta" aria-label="首页实时指标">
          {landingStats.map((stat) => (
            <div key={stat.label} className="landing-meta-item">
              <dt>{stat.label}</dt>
              <dd>
                {stat.value}
                <span>{stat.suffix}</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <span className="sr-only">当前 Helm: {activeHelmLabel}</span>

      <div className="landing-ship-hotspots" aria-label="战舰快捷导航">
        <button
          type="button"
          className="landing-ship-hotspot landing-ship-hotspot-sessions"
          onClick={() => onNavigate("sessions")}
          aria-label="进入工作台"
          data-tooltip="工作台"
        />
        <button
          type="button"
          className="landing-ship-hotspot landing-ship-hotspot-agents"
          onClick={() => onNavigate("agents")}
          aria-label="进入舰队"
          data-tooltip="舰队"
        />
        <button
          type="button"
          className="landing-ship-hotspot landing-ship-hotspot-settings"
          onClick={() => onNavigate("settings")}
          aria-label="进入设置"
          data-tooltip="设置"
        />
      </div>
    </section>
  );
}
