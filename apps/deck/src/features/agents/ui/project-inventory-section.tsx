import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Label } from "@/shared/ui";
import type {
  AcpAgentProvider,
  ProjectSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import {
  createProjectId,
  resolveProjectDisplayId,
  resolveProjectWorktrees,
} from "../utils/fleet-helpers";

export type FleetProjectDraft = { id?: string; name: string; path: string };

type ProjectInventorySectionProps = {
  connected: boolean;
  dispatch: DispatchToHelm;
  draft: FleetProjectDraft;
  formOpen: boolean;
  selectedHelmAgents: AcpAgentProvider[];
  selectedHelmId: string;
  selectedHelmProjects: ProjectSummary[];
  selectedHelmRpcClient: DeckRpcClient | null;
  selectedHelmWorktrees: WorktreeSummary[];
  setDraft: Dispatch<SetStateAction<FleetProjectDraft>>;
  setFormOpen: Dispatch<SetStateAction<boolean>>;
  setSaveMessage: Dispatch<SetStateAction<string>>;
};

export function ProjectInventorySection({
  connected,
  dispatch,
  draft,
  formOpen,
  selectedHelmAgents,
  selectedHelmId,
  selectedHelmProjects,
  selectedHelmRpcClient,
  selectedHelmWorktrees,
  setDraft,
  setFormOpen,
  setSaveMessage,
}: ProjectInventorySectionProps) {
  function cancelEdit() {
    setDraft({ name: "", path: "" });
    setFormOpen(false);
  }

  return (
    <section className="grid content-start gap-3">
      <div className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="m-0 text-base font-semibold text-foreground">项目列表</h3>
        <Button
          variant="outline"
          size="icon"
          type="button"
          disabled={!connected}
          aria-label="添加项目"
          title="添加项目"
          onClick={() => setFormOpen((current) => !current)}
        >
          +
        </Button>
      </div>
      {formOpen ? (
        <form
          className="grid w-full gap-3 rounded-md bg-surface-sunken p-3 sm:grid-cols-[minmax(140px,0.8fr)_minmax(220px,1.4fr)_auto_auto] sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedHelmRpcClient || !draft.path.trim()) {
              return;
            }
            const projectPath = draft.path.trim().replace(/\\/g, "/");
            const fallbackProjectName =
              projectPath.split("/").filter(Boolean).at(-1) ?? projectPath;
            const projectName = draft.name.trim() || fallbackProjectName;
            const existingProject = draft.id
              ? selectedHelmProjects.find((project) => project.id === draft.id)
              : undefined;
            const projectId = existingProject?.id ?? createProjectId(selectedHelmProjects, projectName);
            const existingWorktrees = existingProject?.worktrees ?? [];
            const worktrees = existingWorktrees.length
              ? existingWorktrees
              : [
                  {
                    name: projectName,
                    path: projectPath,
                    branch: existingProject?.gitCurrentBranch,
                    kind: "root" as const,
                  },
                ];
            setSaveMessage(`正在保存项目：${projectName}...`);
            void dispatch(selectedHelmRpcClient, "project/save", {
              project: {
                ...existingProject,
                id: projectId,
                name: projectName,
                helmId: existingProject?.helmId ?? selectedHelmId,
                path: projectPath,
                worktrees,
              },
            });
            setDraft({ name: "", path: "" });
            setFormOpen(false);
          }}
        >
          <Label className="sr-only" htmlFor="fleet-project-name">
            项目名称
          </Label>
          <Input
            id="fleet-project-name"
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="项目名称，例如 Tiller"
          />
          <Label className="sr-only" htmlFor="fleet-project-path">
            项目路径
          </Label>
          <Input
            id="fleet-project-path"
            value={draft.path}
            onChange={(event) =>
              setDraft((current) => ({ ...current, path: event.target.value }))
            }
            placeholder="项目路径，例如 D:/projects/my-app"
          />
          <Button type="submit" disabled={!draft.path.trim()}>
            {draft.id ? "更新项目" : "保存项目"}
          </Button>
          <Button variant="outline" type="button" onClick={cancelEdit}>
            取消
          </Button>
        </form>
      ) : null}
      {selectedHelmProjects.length ? (
        <ul className="m-0 grid list-none divide-y divide-border-ghost border-t border-border-ghost p-0">
          {selectedHelmProjects.map((project) => (
            <li key={project.id} className="py-3">
              <details className="group grid gap-2">
                <summary className="grid cursor-pointer list-none grid-cols-[minmax(180px,0.35fr)_minmax(0,1fr)] items-baseline gap-3 marker:hidden max-md:grid-cols-1 max-md:gap-1 [&::-webkit-details-marker]:hidden">
                  <strong className="text-sm font-semibold text-foreground group-open:text-primary group-hover:text-primary">
                    {project.name}
                  </strong>
                  <span className="[overflow-wrap:anywhere] text-sm text-muted-foreground">
                    {project.path
                      ? `路径 · ${project.path}`
                      : `项目 · ${project.id}`}
                  </span>
                </summary>
                <dl className="m-0 grid gap-2 rounded-md bg-surface-sunken p-3 text-sm">
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Project ID</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                      {resolveProjectDisplayId(project, selectedHelmProjects)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Path</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{project.path ?? "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Helm ID</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{project.helmId}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Git Branch</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                      {project.gitCurrentBranch ?? "-"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
                    <dt className="font-semibold text-muted-foreground">Worktrees</dt>
                    <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                      <ProjectWorktreeList
                        project={project}
                        worktrees={selectedHelmWorktrees}
                      />
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-border-ghost pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={!connected}
                      aria-label={`编辑项目 ${project.name}`}
                      onClick={() => {
                        setDraft({
                          id: project.id,
                          name: project.name,
                          path: project.path ?? "",
                        });
                        setFormOpen(true);
                      }}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      disabled={!connected || !selectedHelmRpcClient}
                      aria-label={`删除项目 ${project.name}`}
                      onClick={() => {
                        if (!selectedHelmRpcClient) {
                          return;
                        }
                        setSaveMessage(`正在删除项目：${project.name}...`);
                        void dispatch(selectedHelmRpcClient, "project/delete", {
                          projectId: project.id,
                        });
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-16 place-items-center rounded-md bg-surface-sunken px-4 text-sm text-muted-foreground">
          {connected ? "当前 Helm 暂无项目数据" : "请先连接该 Helm 后加载项目"}
        </div>
      )}
    </section>
  );
}

function ProjectWorktreeList({
  project,
  worktrees,
}: {
  project: ProjectSummary;
  worktrees: WorktreeSummary[];
}) {
  const resolvedWorktrees = resolveProjectWorktrees(project, worktrees);

  if (!resolvedWorktrees.length) {
    return <span>-</span>;
  }

  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {resolvedWorktrees.map((worktree) => (
        <li key={worktree.path} className="grid gap-0.5">
          <span className="font-medium text-foreground">{worktree.name}</span>
          <span className="break-all text-xs text-muted-foreground">{worktree.path}</span>
        </li>
      ))}
    </ul>
  );
}
