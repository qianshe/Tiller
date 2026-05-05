import { useRef, useState } from "react";
import type {
  AgentPromptContent,
  SessionReasoningEffort,
  SessionSummary,
} from "@tiller/shared";
import type { AgentDraft } from "../../features/agents";
import type { DaemonProfile } from "../../features/helm-connection";
import {
  DEFAULT_PROMPT,
  MODEL_OPTIONS,
  type ProjectFilesEntry,
} from "../../features/mission";
import { DEFAULT_DAEMON_HOST, DEFAULT_DAEMON_PORT } from "../../shared/config/deck-runtime";

/**
 * Owns App refs and local UI state so root can stay focused on wiring.
 */
export function useAppRuntimeState(missionVisualFixture: any) {
  const socketRef = useRef<WebSocket | null>(null);
  const helmSocketRefs = useRef<Map<string, WebSocket>>(new Map());
  const requestCounter = useRef(0);
  const pairInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastPairingAttemptRef = useRef<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);
  const pendingPromptContentRef = useRef<AgentPromptContent[] | undefined>(undefined);
  const promptModelPickerRef = useRef<HTMLDivElement | null>(null);
  const missionPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const chatMainRef = useRef<HTMLDivElement | null>(null);
  const preserveChatScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const stickChatToBottomRef = useRef(true);
  const lastAutoScrollSessionIdRef = useRef<string | null>(null);
  const pendingSessionScrollToBottomRef = useRef<string | null>(null);
  const worktreePickerRef = useRef<HTMLDivElement | null>(null);
  const agentPickerRef = useRef<HTMLDivElement | null>(null);
  const pendingAddHelmProfileRef = useRef<DaemonProfile | null>(null);
  const primaryHelmKeyRef = useRef<string | null>(null);
  const resumeStartRequestsRef = useRef<Set<string>>(new Set());

  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [sessionOpenScrollTick, setSessionOpenScrollTick] = useState(0);
  const [projectFilesByScope, setProjectFilesByScope] = useState<Record<string, ProjectFilesEntry>>({});
  const [projectFileFilter, setProjectFileFilter] = useState("");
  const [collapsedProjectFileDirectories, setCollapsedProjectFileDirectories] = useState<Set<string>>(() => new Set());
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(missionVisualFixture?.selectedProjectId ?? null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(missionVisualFixture?.selectedWorkspaceId ?? null);
  const [worktreePickerOpen, setWorktreePickerOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(missionVisualFixture?.selectedAgentId ?? null);
  const [selectedAgentMode, setSelectedAgentMode] = useState<string>(missionVisualFixture?.sessions[0]?.agentMode ?? "");
  const [selectedModel, setSelectedModel] = useState<string>(missionVisualFixture?.sessions[0]?.model ?? MODEL_OPTIONS[0]);
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<SessionReasoningEffort>("medium");
  const [agentTestResult, setAgentTestResult] = useState<string>("尚未测试");
  const [resumeFeedback, setResumeFeedback] = useState<string>("");
  const [selectedMissionHelmId, setSelectedMissionHelmId] = useState<string | null>(missionVisualFixture?.sessions[0]?.helmId ?? null);
  const [expandedMissionHelmIds, setExpandedMissionHelmIds] = useState<Set<string>>(() => new Set());
  const [expandedMissionProjectIds, setExpandedMissionProjectIds] = useState<Set<string>>(() => new Set());
  const [missionConfigPicker, setMissionConfigPicker] = useState<"agentMode" | "model" | "reasoning" | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>({ name: "OpenCode", command: "opencode", args: "acp --pure" });
  const [draftSaveMessage, setDraftSaveMessage] = useState<string>("草稿未保存");
  const [configSaveMessage, setConfigSaveMessage] = useState<string>("尚未写入 Helm 配置");
  const [agentConfigExpanded, setAgentConfigExpanded] = useState(false);
  const [fleetAddHelmModalOpen, setFleetAddHelmModalOpen] = useState(false);
  const [fleetAddHelmStage, setFleetAddHelmStage] = useState<"connect" | "connecting" | "pair">("connect");
  const [fleetAddHelmName, setFleetAddHelmName] = useState<string>("");
  const [fleetAddHelmHost, setFleetAddHelmHost] = useState<string>(DEFAULT_DAEMON_HOST);
  const [fleetAddHelmPort, setFleetAddHelmPort] = useState<string>(DEFAULT_DAEMON_PORT);
  const [fleetProjectFormOpen, setFleetProjectFormOpen] = useState(false);
  const [fleetProjectDraft, setFleetProjectDraft] = useState({ name: "", path: "" });
  const [fleetProjectSaveMessage, setFleetProjectSaveMessage] = useState("");
  const [fleetAgentFormOpen, setFleetAgentFormOpen] = useState(false);
  const [fleetAgentDraft, setFleetAgentDraft] = useState({ name: "", command: "", args: [""] });
  const [pendingHelmDeleteProfile, setPendingHelmDeleteProfile] = useState<DaemonProfile | null>(null);
  const [pendingSessionCleanup, setPendingSessionCleanup] = useState<SessionSummary | null>(null);
  const [daemonProfileName, setDaemonProfileName] = useState<string>("");
  const [daemonProfileMessage, setDaemonProfileMessage] = useState<string>("");

  return {
    socketRef, helmSocketRefs, requestCounter, pairInputRefs, lastPairingAttemptRef,
    pendingPromptRef, pendingPromptContentRef, promptModelPickerRef, missionPromptRef,
    chatMainRef, preserveChatScrollRef, stickChatToBottomRef, lastAutoScrollSessionIdRef,
    pendingSessionScrollToBottomRef, worktreePickerRef, agentPickerRef,
    pendingAddHelmProfileRef, primaryHelmKeyRef, resumeStartRequestsRef,
    expandedMessageIds, setExpandedMessageIds, sessionOpenScrollTick, setSessionOpenScrollTick,
    projectFilesByScope, setProjectFilesByScope, projectFileFilter, setProjectFileFilter,
    collapsedProjectFileDirectories, setCollapsedProjectFileDirectories, prompt, setPrompt,
    selectedProjectId, setSelectedProjectId, selectedWorkspaceId, setSelectedWorkspaceId,
    worktreePickerOpen, setWorktreePickerOpen, agentPickerOpen, setAgentPickerOpen,
    selectedAgentId, setSelectedAgentId, selectedAgentMode, setSelectedAgentMode,
    selectedModel, setSelectedModel, selectedReasoningEffort, setSelectedReasoningEffort,
    agentTestResult, setAgentTestResult, resumeFeedback, setResumeFeedback,
    selectedMissionHelmId, setSelectedMissionHelmId, expandedMissionHelmIds, setExpandedMissionHelmIds,
    expandedMissionProjectIds, setExpandedMissionProjectIds, missionConfigPicker, setMissionConfigPicker,
    agentDraft, setAgentDraft, draftSaveMessage, setDraftSaveMessage,
    configSaveMessage, setConfigSaveMessage, agentConfigExpanded, setAgentConfigExpanded,
    fleetAddHelmModalOpen, setFleetAddHelmModalOpen, fleetAddHelmStage, setFleetAddHelmStage,
    fleetAddHelmName, setFleetAddHelmName, fleetAddHelmHost, setFleetAddHelmHost,
    fleetAddHelmPort, setFleetAddHelmPort, fleetProjectFormOpen, setFleetProjectFormOpen,
    fleetProjectDraft, setFleetProjectDraft, fleetProjectSaveMessage, setFleetProjectSaveMessage,
    fleetAgentFormOpen, setFleetAgentFormOpen, fleetAgentDraft, setFleetAgentDraft,
    pendingHelmDeleteProfile, setPendingHelmDeleteProfile, pendingSessionCleanup, setPendingSessionCleanup,
    daemonProfileName, setDaemonProfileName, daemonProfileMessage, setDaemonProfileMessage,
  };
}
