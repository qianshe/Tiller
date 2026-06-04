import type { Dispatch, SetStateAction } from "react";
import { Button, Input, Label } from "@/shared/ui";
import type {
  AcpAgentProvider,
  ProjectFileSummary,
  ProjectSummary,
  WorktreeSummary,
} from "@tiller/shared";
import type { DeckRpcClient, DispatchToHelm } from "../../helm-connection/facade";
import {
  buildProjectSavePayload,
  resolveProjectDisplayId,
  resolveProjectWorktrees,
} from "../utils/fleet-helpers";
import { InventoryTable } from "./inventory-table";

export type FleetProjectDraft = { id?: string; name: string; path: string; summaryFile: string };

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
  projectPathCandidates: string[];
  requestProjectPathCandidates: (path: string) => void;
  summaryFileCandidates: ProjectFileSummary[];
  requestSummaryFileCandidates: (project: ProjectSummary) => void;
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
  projectPathCandidates,
  requestProjectPathCandidates,
  summaryFileCandidates,
  requestSummaryFileCandidates,
}: ProjectInventorySectionProps) {
  function cancelEdit() {
    setDraft({ name: "", path: "", summaryFile: "" });
    setFormOpen(false);
  }

  const editingProject = draft.id
    ? selectedHelmProjects.find((project) => project.id === draft.id)
    : undefined;
  const isEditingProject = Boolean(editingProject);
  const formClassName = isEditingProject
    ? "grid w-full gap-3 rounded-md bg-surface-sunken p-3 pr-28 xl:grid-cols-[minmax(140px,0.8fr)_minmax(220px,1.2fr)_minmax(180px,1fr)_auto_auto] xl:items-center"
    : "grid w-full gap-3 rounded-md bg-surface-sunken p-3 pr-28 xl:grid-cols-[minmax(140px,0.8fr)_minmax(220px,1.4fr)_auto_auto] xl:items-center";

  function requestEditingProjectSummaryFiles() {
    if (editingProject) {
      requestSummaryFileCandidates(createProjectPreview(editingProject, draft));
    }
  }

  return (
    <InventoryTable
      title="项目列表"
      action={(
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
      )}
      form={formOpen ? (
        <form
          className={formClassName}
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedHelmRpcClient || !draft.path.trim()) {
              return;
            }
            const payload = buildProjectSavePayload({
              draft,
              selectedHelmId,
              selectedHelmProjects,
            });
            setSaveMessage(`正在保存项目：${payload.projectName}...`);
            void dispatch(selectedHelmRpcClient, "project/save", {
              project: payload.project,
            });
            setDraft({ name: "", path: "", summaryFile: "" });
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
            list="fleet-project-path-options"
            value={draft.path}
            onFocus={() => requestProjectPathCandidates(draft.path)}
            onChange={(event) => {
              const nextPath = event.target.value;
              setDraft((current) => ({ ...current, path: nextPath }));
              requestProjectPathCandidates(nextPath);
            }}
            placeholder="项目路径，例如 D:/projects/my-app"
          />
          <datalist id="fleet-project-path-options">
            {projectPathCandidates.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          {isEditingProject ? (
            <>
              <Label className="sr-only" htmlFor="fleet-project-summary-file">
                摘要文件
              </Label>
              <Input
                id="fleet-project-summary-file"
                list="fleet-project-summary-file-options"
                value={draft.summaryFile}
                onClick={requestEditingProjectSummaryFiles}
                onFocus={requestEditingProjectSummaryFiles}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, summaryFile: event.target.value }))
                }
                placeholder="默认读取 AGENTS.md、CLAUDE.md 或 README.md"
              />
              <datalist id="fleet-project-summary-file-options">
                {filterSummaryFileCandidates(summaryFileCandidates).map((file) => (
                  <option key={file.path} value={file.path} />
                ))}
              </datalist>
            </>
          ) : null}
          <Button type="submit" disabled={!draft.path.trim()}>
            {draft.id ? "更新项目" : "保存项目"}
          </Button>
          <Button variant="outline" type="button" onClick={cancelEdit}>
            取消
          </Button>
        </form>
      ) : null}
      rows={selectedHelmProjects.map((project) => {
        const previewProject = createProjectPreview(project, draft);
        return {
          key: project.id,
          title: previewProject.name,
          subtitle: previewProject.path
            ? `路径 · ${previewProject.path}`
            : `项目 · ${previewProject.id}`,
          details: (
          <dl className="m-0 grid gap-2 text-sm">
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
              <dt className="font-semibold text-muted-foreground">Project ID</dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                {resolveProjectDisplayId(previewProject, selectedHelmProjects)}
              </dd>
            </div>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
              <dt className="font-semibold text-muted-foreground">Path</dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                {previewProject.path ?? "-"}
              </dd>
            </div>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
              <dt className="font-semibold text-muted-foreground">Summary File</dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                {formatSummaryFile(previewProject.summaryFile)}
              </dd>
            </div>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
              <dt className="font-semibold text-muted-foreground">Helm ID</dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-foreground">{previewProject.helmId}</dd>
            </div>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
              <dt className="font-semibold text-muted-foreground">Git Branch</dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                {previewProject.gitCurrentBranch ?? "-"}
              </dd>
            </div>
            <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 max-md:grid-cols-1 max-md:gap-1">
              <dt className="font-semibold text-muted-foreground">Worktrees</dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-foreground">
                <ProjectWorktreeList
                  project={previewProject}
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
                    summaryFile: project.summaryFile ?? "",
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
          ),
        };
      })}
      emptyLabel={connected ? "当前 Helm 暂无项目数据" : "请先连接该 Helm 后加载项目"}
    />
  );
}

function createProjectPreview(project: ProjectSummary, draft: FleetProjectDraft) {
  if (draft.id !== project.id) {
    return project;
  }
  const summaryFile = draft.summaryFile.trim() || undefined;
  return {
    ...project,
    name: draft.name.trim() || project.name,
    path: draft.path.trim() || project.path,
    summaryFile,
  };
}

function formatSummaryFile(summaryFile: string | undefined) {
  return summaryFile ?? "默认：AGENTS.md / CLAUDE.md / README.md";
}

function filterSummaryFileCandidates(files: ProjectFileSummary[]) {
  return files.filter((file) => {
    if (file.kind !== "file") {
      return false;
    }
    const name = file.path.split("/").at(-1)?.toLowerCase() ?? "";
    return (
      name === "agents.md" ||
      name === "claude.md" ||
      name === "readme.md" ||
      name.endsWith(".md") ||
      name.endsWith(".mdx")
    );
  });
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
