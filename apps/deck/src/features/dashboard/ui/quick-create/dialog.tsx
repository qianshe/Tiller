import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../../../../shared/ui";
import type {
  DashboardQuickCreateProject,
  DashboardQuickCreateRequest,
} from "../../types";

type DashboardQuickCreateMode = "new" | "reuse";

function projectOptionValue(project: DashboardQuickCreateProject): string {
  return project.key ?? project.id;
}

type QuickCreateProjectGroup = {
  key: string;
  helmName: string;
  helmEndpoint: string;
  projects: DashboardQuickCreateProject[];
};

function resolveProjectGroups(projects: DashboardQuickCreateProject[]): QuickCreateProjectGroup[] {
  const groups = new Map<string, QuickCreateProjectGroup>();

  for (const project of projects) {
    const key = project.helmKey ?? project.helmEndpoint ?? project.helmName ?? "unknown-helm";
    const group = groups.get(key);
    if (group) {
      group.projects.push(project);
      continue;
    }
    groups.set(key, {
      key,
      helmName: project.helmName ?? "未命名 Helm",
      helmEndpoint: project.helmEndpoint ?? project.helmKey ?? "未知地址",
      projects: [project],
    });
  }

  return Array.from(groups.values());
}

export type DashboardQuickCreateDialogProps = {
  open: boolean;
  projects: DashboardQuickCreateProject[];
  onOpenChange: (open: boolean) => void;
  onCreateTask: (request: DashboardQuickCreateRequest) => boolean | void;
};

export function DashboardQuickCreateDialog({
  open,
  projects,
  onOpenChange,
  onCreateTask,
}: DashboardQuickCreateDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<DashboardQuickCreateMode>("new");
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedIdleSessionId, setSelectedIdleSessionId] = useState("");
  const [submitError, setSubmitError] = useState("");
  const selectedProject = useMemo(
    () => projects.find((project) => projectOptionValue(project) === selectedProjectKey),
    [projects, selectedProjectKey],
  );
  const projectsByHelm = useMemo(() => resolveProjectGroups(projects), [projects]);
  const agents = selectedProject?.agents ?? [];
  const idleSessions = selectedProject?.idleSessions ?? [];
  const selectedIdleSession = idleSessions.find(
    (session) => session.id === selectedIdleSessionId,
  );
  const canSubmit = Boolean(
    prompt.trim() &&
      selectedProject?.helmKey &&
      selectedProject?.projectId &&
      (mode === "new"
        ? selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)
        : selectedIdleSession),
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setPrompt("");
    setMode("new");
    setSelectedProjectKey("");
    setSelectedAgentId("");
    setSelectedIdleSessionId("");
    setSubmitError("");
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPrompt("");
      setMode("new");
      setSelectedProjectKey("");
      setSelectedAgentId("");
      setSelectedIdleSessionId("");
      setSubmitError("");
    }
    onOpenChange(nextOpen);
  };

  const handleProjectChange = (projectKey: string) => {
    setSelectedProjectKey(projectKey);
    setSelectedAgentId("");
    setSelectedIdleSessionId("");
    setSubmitError("");
  };

  const handleModeChange = (nextMode: string) => {
    setMode(nextMode as DashboardQuickCreateMode);
    setSelectedAgentId("");
    setSelectedIdleSessionId("");
    setSubmitError("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !selectedProject) {
      return;
    }
    const target = {
      prompt: prompt.trim(),
      projectId: selectedProject.projectId ?? selectedProject.id,
      helmKey: selectedProject.helmKey ?? "",
      cwd: selectedProject.cwd ?? null,
    };
    const accepted = mode === "reuse" && selectedIdleSession
      ? onCreateTask({
          ...target,
          mode: "reuse",
          sessionId: selectedIdleSession.id,
        })
      : onCreateTask({
          ...target,
          mode: "new",
          agentId: selectedAgentId,
        });
    if (accepted === false) {
      setSubmitError("任务未创建，请检查目标 Helm 连接和项目工作区。");
      return;
    }
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-4xl gap-0 overflow-hidden rounded-xl p-0 [&>button]:right-6 [&>button]:top-6"
        data-testid="dashboard-quick-create-dialog"
      >
        <form
          className="flex min-h-[460px] max-h-[calc(100vh-2rem)] flex-col"
          onSubmit={handleSubmit}
        >
          <DialogHeader className="shrink-0 border-b border-border-ghost px-7 py-5 pr-16 text-left">
            <div className="flex min-w-0 items-center gap-2 font-mono text-meta text-muted-foreground">
              <span className="shrink-0">Tiller</span>
              <Icon name="chevronRight" size={12} />
              <DialogTitle className="truncate text-section font-semibold text-foreground">
                快速创建任务
              </DialogTitle>
            </div>
            <DialogDescription className="mt-1.5 text-meta text-muted-foreground">
              选择项目后新建会话，或继续该工作区中已有的空闲会话。
            </DialogDescription>
          </DialogHeader>

          <div
            className="flex min-h-0 flex-1 flex-col px-7 py-6"
            data-slot="dashboard-quick-create-prompt-canvas"
          >
            <Label className="sr-only" htmlFor="dashboard-quick-create-prompt">
              任务内容
            </Label>
            <Textarea
              id="dashboard-quick-create-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="告诉 Agent 需要完成什么，例如：修复当前项目中的横向滚动问题"
              className="min-h-[220px] flex-1 resize-none border-0 bg-transparent p-0 text-[18px] leading-8 shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
              autoFocus
            />
          </div>

          <div
            className="shrink-0 border-t border-border-ghost bg-surface-sunken/45 px-5 py-4"
            data-slot="dashboard-quick-create-target-dock"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-meta font-medium text-foreground">执行方式</span>
                <span className="ml-2 hidden text-meta text-muted-foreground sm:inline">
                  复用会保留旧会话上下文
                </span>
              </div>
              <Tabs value={mode} onValueChange={handleModeChange}>
                <TabsList size="sm" aria-label="选择会话执行方式">
                  <TabsTrigger className="gap-1.5" size="sm" value="new" type="button">
                    <Icon name="plus" size={12} />
                    新建会话
                  </TabsTrigger>
                  <TabsTrigger className="gap-1.5" size="sm" value="reuse" type="button">
                    <Icon name="clock" size={12} />
                    复用空闲会话
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {submitError ||
            (mode === "new" && selectedProject && agents.length === 0) ||
            (mode === "reuse" && selectedProject && idleSessions.length === 0) ? (
              <p
                className={submitError ? "mb-2 text-meta text-destructive" : "mb-2 text-meta text-muted-foreground"}
                role={submitError ? "alert" : "status"}
              >
                {submitError || (mode === "reuse"
                  ? "该项目工作区暂无可复用的空闲会话。"
                  : "该 Helm 暂无 Agent，请先完成 Agent 配置。")}
              </p>
            ) : null}

            <div className="grid min-w-0 grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(170px,0.8fr)_auto]">
              <div className="grid min-w-0 gap-1.5">
                <Label className="text-meta font-medium text-muted-foreground" htmlFor="dashboard-quick-create-project">
                  项目
                </Label>
                <Select value={selectedProjectKey} onValueChange={handleProjectChange}>
                  <SelectTrigger
                    id="dashboard-quick-create-project"
                    className="h-10 min-w-0 bg-surface px-3"
                  >
                    <div
                      data-slot="dashboard-quick-create-project-value"
                      className="flex min-w-0 items-center gap-2"
                    >
                      <Icon name="folder" size={13} />
                      <SelectValue
                        className="truncate"
                        placeholder={projects.length ? "选择项目" : "暂无可用项目"}
                      >
                        {selectedProject ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{selectedProject.name}</span>
                            <span className="shrink-0 font-mono text-meta text-muted-foreground">
                              / {selectedProject.branch}
                            </span>
                          </span>
                        ) : null}
                      </SelectValue>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="max-h-[360px] w-[min(460px,calc(100vw-2rem))]">
                    {projectsByHelm.map((group) => (
                      <SelectGroup key={group.key}>
                        <SelectLabel className="sticky top-0 flex min-w-0 items-center gap-2 bg-surface-elevated py-2 text-meta text-muted-foreground">
                          <Icon name="server" size={12} />
                          <span className="truncate font-medium text-foreground">{group.helmName}</span>
                          <span className="ml-auto truncate font-mono font-normal">{group.helmEndpoint}</span>
                        </SelectLabel>
                        {group.projects.map((project) => (
                          <SelectItem
                            key={projectOptionValue(project)}
                            value={projectOptionValue(project)}
                            textValue={`${project.name} ${project.branch}`}
                            className="py-2.5 pr-3"
                          >
                            <span className="grid min-w-0 gap-0.5">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate font-medium">{project.name}</span>
                                <span className="shrink-0 font-mono text-meta text-muted-foreground">
                                  / {project.branch}
                                </span>
                              </span>
                              <span className="truncate font-mono text-meta text-muted-foreground">
                                {project.cwd ?? project.id}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {mode === "new" ? (
                <div className="grid min-w-0 gap-1.5">
                  <Label className="text-meta font-medium text-muted-foreground" htmlFor="dashboard-quick-create-agent">
                    Agent
                  </Label>
                  <Select
                    value={selectedAgentId}
                    onValueChange={setSelectedAgentId}
                    disabled={!selectedProject || agents.length === 0}
                  >
                    <SelectTrigger
                      id="dashboard-quick-create-agent"
                      className="h-10 min-w-0 bg-surface px-3"
                    >
                      <div
                        data-slot="dashboard-quick-create-agent-value"
                        className="flex min-w-0 items-center gap-2"
                      >
                        <Icon name="fleet" size={13} />
                        <SelectValue
                          className="truncate"
                          placeholder={
                            !selectedProject
                              ? "请先选择项目"
                              : agents.length
                                ? "选择 Agent"
                                : "该 Helm 暂无 Agent"
                          }
                        />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid min-w-0 gap-1.5">
                  <Label className="text-meta font-medium text-muted-foreground" htmlFor="dashboard-quick-create-idle-session">
                    空闲会话
                  </Label>
                  <Select
                    value={selectedIdleSessionId}
                    onValueChange={setSelectedIdleSessionId}
                    disabled={!selectedProject || idleSessions.length === 0}
                  >
                    <SelectTrigger
                    id="dashboard-quick-create-idle-session"
                      className="h-10 min-w-0 overflow-hidden bg-surface px-3"
                    >
                      <div className="flex w-full min-w-0 items-center gap-2 overflow-hidden">
                        <Icon className="shrink-0" name="message" size={13} />
                        <SelectValue
                          className="min-w-0 flex-1 overflow-hidden truncate"
                          placeholder={
                            !selectedProject
                              ? "请先选择项目"
                              : idleSessions.length
                                ? "选择空闲会话"
                                : "暂无空闲会话"
                          }
                        >
                          {selectedIdleSession ? (
                            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                              <span className="min-w-0 flex-1 truncate">{selectedIdleSession.title}</span>
                              <span className="max-w-24 shrink-0 truncate text-meta text-muted-foreground">
                                / {selectedIdleSession.agentName}
                              </span>
                            </span>
                          ) : null}
                        </SelectValue>
                      </div>
                    </SelectTrigger>
                    <SelectContent className="w-[min(420px,calc(100vw-2rem))]">
                      <SelectGroup>
                        {idleSessions.map((session) => (
                          <SelectItem
                            key={session.id}
                            value={session.id}
                            textValue={`${session.title} ${session.agentName}`}
                          >
                            <span className="flex w-full min-w-0 items-center gap-1.5 overflow-hidden">
                              <span className="min-w-0 flex-1 truncate font-medium">{session.title}</span>
                              <span className="max-w-24 shrink-0 truncate text-meta text-muted-foreground">
                                / {session.agentName}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid min-w-0 gap-1.5" data-testid="dashboard-quick-create-runtime">
                <span className="text-meta font-medium text-muted-foreground">运行节点</span>
                <div className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-border-ghost bg-surface px-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded bg-surface-sunken text-muted-foreground">
                    <Icon name="server" size={12} />
                  </span>
                  <span
                    className="min-w-0 truncate text-section font-medium text-foreground"
                    aria-live="polite"
                  >
                    {selectedProject ? selectedProject.helmName ?? "未命名 Helm" : "待选择"}
                  </span>
                </div>
              </div>

              <Button className="h-10 shrink-0 px-4" type="submit" disabled={!canSubmit}>
                <Icon name={mode === "reuse" ? "send" : "plus"} />
                {mode === "reuse" ? "继续会话" : "创建任务"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
