import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  AcpAgentProvider,
  ProjectSummary,
  WorkspaceSummary,
} from "@tiller/shared";
import {
  createProjectId,
  defaultAgentId,
  dispatch,
  nextRequestId,
  resolveProjectDisplayId,
  resolveProjectWorkspaceLabel,
} from "../utils/fleet-helpers";

export type FleetProjectDraft = { name: string; path: string };

type ProjectInventorySectionProps = {
  connected: boolean;
  draft: FleetProjectDraft;
  formOpen: boolean;
  requestCounter: MutableRefObject<number>;
  selectedHelmAgents: AcpAgentProvider[];
  selectedHelmId: string;
  selectedHelmProjects: ProjectSummary[];
  selectedHelmSocket: WebSocket | null;
  selectedHelmWorkspaces: WorkspaceSummary[];
  setDraft: Dispatch<SetStateAction<FleetProjectDraft>>;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  setSaveMessage: Dispatch<SetStateAction<string>>;
};

export function ProjectInventorySection({
  connected,
  draft,
  formOpen,
  requestCounter,
  selectedHelmAgents,
  selectedHelmId,
  selectedHelmProjects,
  selectedHelmSocket,
  selectedHelmWorkspaces,
  setDraft,
  setFormOpen,
  setSaveMessage,
}: ProjectInventorySectionProps) {
  return (
    <section className="helm-inventory-list-section">
      <div className="helm-inventory-section-head">
        <h3>项目列表</h3>
        <button
          className="secondary helm-list-add-button"
          type="button"
          disabled={!connected}
          aria-label="添加项目"
          title="添加项目"
          onClick={() => setFormOpen((current) => !current)}
        >
          +
        </button>
      </div>
      {formOpen ? (
        <form
          className="helm-inline-add-form helm-inline-add-form-project"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedHelmSocket || !draft.path.trim()) {
              return;
            }
            const projectPath = draft.path.trim().replace(/\\/g, "/");
            const fallbackProjectName =
              projectPath.split("/").filter(Boolean).at(-1) ?? projectPath;
            const projectName = draft.name.trim() || fallbackProjectName;
            const projectId = createProjectId(selectedHelmProjects);
            const workspaceId = `${projectId}-workspace`;
            setSaveMessage(`正在保存项目：${projectName}...`);
            dispatch(selectedHelmSocket, {
              type: "project.save",
              requestId: nextRequestId(requestCounter),
              project: {
                id: projectId,
                name: projectName,
                helmId: selectedHelmId,
                path: projectPath,
                workspaceIds: [workspaceId],
                defaultWorkspaceId: workspaceId,
                defaultAgentId: defaultAgentId(selectedHelmAgents) ?? undefined,
              },
            });
            setDraft({ name: "", path: "" });
            setFormOpen(false);
          }}
        >
          <input
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="项目名称，例如 Tiller"
          />
          <input
            value={draft.path}
            onChange={(event) =>
              setDraft((current) => ({ ...current, path: event.target.value }))
            }
            placeholder="项目路径，例如 D:/projects/my-app"
          />
          <button
            className="primary"
            type="submit"
            disabled={!draft.path.trim()}
          >
            保存项目
          </button>
        </form>
      ) : null}
      {selectedHelmProjects.length ? (
        <ul className="helm-simple-list">
          {selectedHelmProjects.map((project) => (
            <li key={project.id}>
              <details className="helm-simple-detail-row">
                <summary>
                  <strong>{project.name}</strong>
                  <span>
                    {project.path
                      ? `路径 · ${project.path}`
                      : `项目 · ${project.id}`}
                  </span>
                </summary>
                <dl>
                  <div>
                    <dt>Project ID</dt>
                    <dd>
                      {resolveProjectDisplayId(project, selectedHelmProjects)}
                    </dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{project.path ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Helm ID</dt>
                    <dd>{project.helmId}</dd>
                  </div>
                  <div>
                    <dt>默认分支</dt>
                    <dd>
                      {resolveProjectWorkspaceLabel(
                        project,
                        selectedHelmWorkspaces,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Default Agent</dt>
                    <dd>{project.defaultAgentId ?? "-"}</dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          {connected ? "当前 Helm 暂无项目数据" : "请先连接该 Helm 后加载项目"}
        </div>
      )}
    </section>
  );
}
