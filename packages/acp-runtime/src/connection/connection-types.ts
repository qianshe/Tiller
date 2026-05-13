import type { ChildProcess } from "node:child_process";
import type { AcpAgentProvider, WorktreeSummary } from "@tiller/shared";
import type { DetectedAcpSessionCapabilities } from "../capabilities";
import type { AcpConnectionKey } from "./connection-key";

export type AcpConnectionStatus = "starting" | "ready" | "idle" | "error" | "closed";

export type AcpConnectionDescriptor = {
  key: AcpConnectionKey;
  providerId: AcpAgentProvider["id"];
  cwd: WorktreeSummary["path"];
  worktreeName?: WorktreeSummary["name"];
  launchCwd: string;
};

export type AcpConnectionSessionInventoryItem = {
  tillerSessionId: string;
  runtimeSessionId: string;
  cwd: WorktreeSummary["path"];
  worktreeName?: WorktreeSummary["name"];
};

export type AcpConnectionInventoryItem = AcpConnectionDescriptor & {
  status: AcpConnectionStatus;
  runtimeConnectionId: string;
  initialized: boolean;
  activeSessionCount: number;
  pendingSessionCount: number;
  sessions: AcpConnectionSessionInventoryItem[];
  capabilities: DetectedAcpSessionCapabilities;
  pid?: ChildProcess["pid"];
  lastError?: string;
};

export type PendingAcpSession<T> = {
  promise: Promise<T>;
  refCount: number;
};
