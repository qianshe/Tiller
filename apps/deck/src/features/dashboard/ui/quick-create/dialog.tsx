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
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../../../../shared/ui";
import type {
  DashboardQuickCreateHelm,
  DashboardQuickCreateProject,
  DashboardQuickCreatePreset,
  DashboardQuickCreateRequest,
} from "../../types";

type DashboardQuickCreateMode = "new" | "reuse";

function projectOptionValue(project: DashboardQuickCreateProject): string {
  return project.key ?? project.id;
}

const LATER_PROJECT_VALUE = "__tiller_later__";
const LATER_AGENT_VALUE = "__tiller_agent_later__";

export type DashboardQuickCreateDialogProps = {
  open: boolean;
  helms: DashboardQuickCreateHelm[];
  projects: DashboardQuickCreateProject[];
  preset?: DashboardQuickCreatePreset | null;
  onOpenChange: (open: boolean) => void;
  onCreateTask: (request: DashboardQuickCreateRequest) => boolean | void;
};

export function DashboardQuickCreateDialog({
  open,
  helms,
  projects,
  preset = null,
  onOpenChange,
  onCreateTask,
}: DashboardQuickCreateDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<DashboardQuickCreateMode>("new");
  const [selectedProjectKey, setSelectedProjectKey] = useState("");
  const [selectedHelmKey, setSelectedHelmKey] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedIdleSessionId, setSelectedIdleSessionId] = useState("");
  const [submitError, setSubmitError] = useState("");
  const selectedHelm = useMemo(
    () => helms.find((helm) => helm.key === selectedHelmKey),
    [helms, selectedHelmKey],
  );
  const projectsForHelm = useMemo(
    () => projects.filter((project) => project.helmKey === selectedHelmKey),
    [projects, selectedHelmKey],
  );
  const selectedProject = useMemo(
    () => projectsForHelm.find((project) => projectOptionValue(project) === selectedProjectKey),
    [projectsForHelm, selectedProjectKey],
  );
  const agents = selectedHelm?.agents ?? [];
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const idleSessions = selectedProject?.idleSessions ?? [];
  const selectedIdleSession = idleSessions.find(
    (session) => session.id === selectedIdleSessionId,
  );
  const presetProjectKey = useMemo(() => {
    if (!preset) {
      return "";
    }
    const project = projects.find((item) =>
      (preset.projectId ? item.projectId === preset.projectId : true) &&
      (preset.helmKey ? item.helmKey === preset.helmKey : true) &&
      (preset.cwd ? item.cwd === preset.cwd : true),
    );
    return project ? projectOptionValue(project) : "";
  }, [preset, projects]);
  const defaultHelmKey = preset?.helmKey ?? helms[0]?.key ?? "";
  const canSubmit = Boolean(
    prompt.trim() &&
      selectedHelmKey &&
      (mode === "new"
        ? true
        : selectedProject?.projectId && selectedIdleSession),
  );

  const isCompleteNewTask = Boolean(
    selectedProject?.projectId &&
    selectedProject.cwd &&
    selectedAgent,
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    setPrompt(preset?.prompt?.trim() || preset?.title?.trim() || "");
    setMode("new");
    setSelectedProjectKey(presetProjectKey || LATER_PROJECT_VALUE);
    setSelectedHelmKey(defaultHelmKey);
    setSelectedAgentId(preset?.agentId ?? LATER_AGENT_VALUE);
    setSelectedIdleSessionId("");
    setSubmitError("");
  }, [defaultHelmKey, open, preset?.agentId, preset?.prompt, preset?.title, presetProjectKey]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPrompt("");
      setMode("new");
      setSelectedProjectKey("");
      setSelectedHelmKey("");
      setSelectedAgentId("");
      setSelectedIdleSessionId("");
      setSubmitError("");
    }
    onOpenChange(nextOpen);
  };

  const handleProjectChange = (projectKey: string) => {
    setSelectedProjectKey(projectKey);
    setSelectedAgentId(LATER_AGENT_VALUE);
    setSelectedIdleSessionId("");
    setSubmitError("");
  };

  const handleHelmChange = (helmKey: string) => {
    setSelectedHelmKey(helmKey);
    setSelectedProjectKey(LATER_PROJECT_VALUE);
    setSelectedAgentId(LATER_AGENT_VALUE);
    setSelectedIdleSessionId("");
    setSubmitError("");
  };

  const handleModeChange = (nextMode: string) => {
    setMode(nextMode as DashboardQuickCreateMode);
    setSelectedAgentId(LATER_AGENT_VALUE);
    setSelectedIdleSessionId("");
    setSubmitError("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const helmKey = selectedHelmKey;
    if (!helmKey) return;
    const target = {
      prompt: prompt.trim(),
      ...(preset?.title?.trim() ? { title: preset.title.trim() } : {}),
      helmKey,
      projectId: selectedProject?.projectId ?? null,
      cwd: selectedProject?.cwd ?? null,
      ...(preset?.preparationId ? { preparationId: preset.preparationId } : {}),
      ...(preset?.revision !== undefined ? { revision: preset.revision } : {}),
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
          agentId: selectedAgent?.id ?? null,
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
              {mode === "reuse"
                ? "将在已有空闲会话中继续，并保留原有上下文。"
                : isCompleteNewTask
                  ? "将创建真实会话并发送首条内容。"
                  : "只保存内容，不会启动 Agent。补齐项目、工作区和 Agent 后即可开始。"}
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
              autoFocus={!preset?.focusTarget}
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
            (mode === "new" && selectedHelm && agents.length === 0) ||
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
              <div className="grid min-w-0 gap-1.5" data-testid="dashboard-quick-create-runtime">
                <Label className="text-meta font-medium text-muted-foreground" htmlFor="dashboard-quick-create-helm">
                  运行节点
                </Label>
                <Select value={selectedHelmKey} onValueChange={handleHelmChange}>
                  <SelectTrigger id="dashboard-quick-create-helm" className="h-10 min-w-0 bg-surface px-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon name="server" size={13} />
                      <SelectValue className="truncate" placeholder="选择 Helm">
                        {selectedHelm ? <span className="truncate">{selectedHelm.name}</span> : null}
                      </SelectValue>
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {helms.map((helm) => (
                        <SelectItem key={helm.key} value={helm.key} textValue={`${helm.name} ${helm.endpoint}`}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{helm.name}</span>
                            <span className="truncate font-mono text-meta text-muted-foreground">{helm.endpoint}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid min-w-0 gap-1.5">
                <Label className="text-meta font-medium text-muted-foreground" htmlFor="dashboard-quick-create-project">
                  项目
                </Label>
                <Select
                  value={selectedProjectKey}
                  onValueChange={handleProjectChange}
                  disabled={!selectedHelm}
                >
                  <SelectTrigger
                    id="dashboard-quick-create-project"
                    className="h-10 min-w-0 bg-surface px-3"
                    autoFocus={preset?.focusTarget === "project"}
                  >
                    <div
                      data-slot="dashboard-quick-create-project-value"
                      className="flex min-w-0 items-center gap-2"
                    >
                      <Icon name="folder" size={13} />
                      <SelectValue
                        className="truncate"
                        placeholder={projectsForHelm.length ? "选择项目" : "稍后选择项目"}
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
                    <SelectGroup>
                      <SelectItem value={LATER_PROJECT_VALUE}>稍后选择项目</SelectItem>
                      {projectsForHelm.map((project) => (
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
                    disabled={!selectedHelm || agents.length === 0}
                  >
                    <SelectTrigger
                      id="dashboard-quick-create-agent"
                      className="h-10 min-w-0 bg-surface px-3"
                      autoFocus={preset?.focusTarget === "agent"}
                    >
                      <div
                        data-slot="dashboard-quick-create-agent-value"
                        className="flex min-w-0 items-center gap-2"
                      >
                        <Icon name="fleet" size={13} />
                        <SelectValue
                          className="truncate"
                          placeholder={
                            !selectedHelm
                              ? "请先选择 Helm"
                              : agents.length
                                ? "选择 Agent"
                                : "该 Helm 暂无 Agent"
                          }
                        />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value={LATER_AGENT_VALUE}>稍后选择 Agent</SelectItem>
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

              <Button className="h-10 shrink-0 px-4" type="submit" disabled={!canSubmit}>
                <Icon name={mode === "reuse" ? "send" : "plus"} />
                {mode === "reuse" ? "继续会话" : isCompleteNewTask ? "创建并开始会话" : "保存为准备"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
