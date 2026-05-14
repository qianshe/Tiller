import { z } from "zod";
import type { NotificationDescriptor, RequestDescriptor } from "./descriptor";
import * as helmList from "./helm/list";
import * as helmSave from "./helm/save";
import * as projectList from "./project/list";
import * as projectListFiles from "./project/list-files";
import * as projectListWorktrees from "./project/list-worktrees";
import * as projectGitListBranches from "./project/git-list-branches";
import * as projectGitCreateWorktree from "./project/git-create-worktree";
import * as projectSave from "./project/save";
import * as projectDelete from "./project/delete";
import * as agentList from "./agent/list";
import * as agentTest from "./agent/test";
import * as agentConnections from "./agent/connections";
import * as agentConnect from "./agent/connect";
import * as agentReconnect from "./agent/reconnect";
import * as agentSave from "./agent/save";
import * as agentDelete from "./agent/delete";
import * as sessionNew from "./session/new";
import * as sessionDraft from "./session/draft";
import * as sessionDiscardDraft from "./session/discard-draft";
import * as sessionList from "./session/list";
import * as sessionListMessages from "./session/list-messages";
import * as sessionGetArtifacts from "./session/get-artifacts";
import * as sessionCheckResume from "./session/check-resume";
import * as sessionResume from "./session/resume";
import * as sessionPrompt from "./session/prompt";
import * as sessionSubscribe from "./session/subscribe";
import * as sessionUnsubscribe from "./session/unsubscribe";
import * as sessionConfigure from "./session/configure";
import * as sessionSetConfigOption from "./session/set-config-option";
import * as sessionCleanup from "./session/cleanup";
import * as permissionListPending from "./permission/list-pending";
import * as permissionRespond from "./permission/respond";
import * as approvalListPending from "./approval/list-pending";
import * as approvalRespond from "./approval/respond";
import * as approvalCreated from "./approval/created";
import * as approvalResolved from "./approval/resolved";
import * as deviceList from "./device/list";
import * as deviceRevoke from "./device/revoke";
import * as devicePair from "./device/pair";
import * as deviceAuthenticate from "./device/authenticate";
import * as daemonShutdown from "./daemon/shutdown";
import * as sessionRename from "./session/rename";
import * as sessionCancel from "./session/cancel";
import * as sessionUpdate from "./session/update";
import * as errorRaised from "./error/raised";

type AnyDescriptor =
  | RequestDescriptor<string, z.ZodType, z.ZodType>
  | NotificationDescriptor<string, z.ZodType>;

const METHOD_DESCRIPTORS = {
  [helmList.method]: helmList.descriptor,
  [helmSave.method]: helmSave.descriptor,
  [projectList.method]: projectList.descriptor,
  [projectListFiles.method]: projectListFiles.descriptor,
  [projectListWorktrees.method]: projectListWorktrees.descriptor,
  [projectGitListBranches.method]: projectGitListBranches.descriptor,
  [projectGitCreateWorktree.method]: projectGitCreateWorktree.descriptor,
  [projectSave.method]: projectSave.descriptor,
  [projectDelete.method]: projectDelete.descriptor,
  [agentList.method]: agentList.descriptor,
  [agentTest.method]: agentTest.descriptor,
  [agentConnections.method]: agentConnections.descriptor,
  [agentConnect.method]: agentConnect.descriptor,
  [agentReconnect.method]: agentReconnect.descriptor,
  [agentSave.method]: agentSave.descriptor,
  [agentDelete.method]: agentDelete.descriptor,
  [sessionNew.method]: sessionNew.descriptor,
  [sessionDraft.method]: sessionDraft.descriptor,
  [sessionDiscardDraft.method]: sessionDiscardDraft.descriptor,
  [sessionList.method]: sessionList.descriptor,
  [sessionListMessages.method]: sessionListMessages.descriptor,
  [sessionGetArtifacts.method]: sessionGetArtifacts.descriptor,
  [sessionCheckResume.method]: sessionCheckResume.descriptor,
  [sessionResume.method]: sessionResume.descriptor,
  [sessionPrompt.method]: sessionPrompt.descriptor,
  [sessionSubscribe.method]: sessionSubscribe.descriptor,
  [sessionUnsubscribe.method]: sessionUnsubscribe.descriptor,
  [sessionConfigure.method]: sessionConfigure.descriptor,
  [sessionSetConfigOption.method]: sessionSetConfigOption.descriptor,
  [sessionRename.method]: sessionRename.descriptor,
  [sessionCleanup.method]: sessionCleanup.descriptor,
  [permissionListPending.method]: permissionListPending.descriptor,
  [permissionRespond.method]: permissionRespond.descriptor,
  [approvalListPending.method]: approvalListPending.descriptor,
  [approvalRespond.method]: approvalRespond.descriptor,
  [approvalCreated.method]: approvalCreated.descriptor,
  [approvalResolved.method]: approvalResolved.descriptor,
  [deviceList.method]: deviceList.descriptor,
  [deviceRevoke.method]: deviceRevoke.descriptor,
  [devicePair.method]: devicePair.descriptor,
  [deviceAuthenticate.method]: deviceAuthenticate.descriptor,
  [daemonShutdown.method]: daemonShutdown.descriptor,
  [sessionCancel.method]: sessionCancel.descriptor,
  [sessionUpdate.method]: sessionUpdate.descriptor,
  [errorRaised.method]: errorRaised.descriptor,
} as const;

export const METHODS: typeof METHOD_DESCRIPTORS &
  Record<string, AnyDescriptor | undefined> = METHOD_DESCRIPTORS;

export type MethodName = keyof typeof METHOD_DESCRIPTORS;

export const CLIENT_REQUEST_METHODS = [
  helmList.method,
  helmSave.method,
  projectList.method,
  projectListFiles.method,
  projectListWorktrees.method,
  projectGitListBranches.method,
  projectGitCreateWorktree.method,
  projectSave.method,
  projectDelete.method,
  agentList.method,
  agentTest.method,
  agentConnections.method,
  agentConnect.method,
  agentReconnect.method,
  agentSave.method,
  agentDelete.method,
  sessionNew.method,
  sessionDraft.method,
  sessionDiscardDraft.method,
  sessionList.method,
  sessionListMessages.method,
  sessionGetArtifacts.method,
  sessionCheckResume.method,
  sessionResume.method,
  sessionPrompt.method,
  sessionSubscribe.method,
  sessionUnsubscribe.method,
  sessionConfigure.method,
  sessionSetConfigOption.method,
  sessionRename.method,
  sessionCleanup.method,
  permissionListPending.method,
  permissionRespond.method,
  approvalListPending.method,
  approvalRespond.method,
  deviceList.method,
  deviceRevoke.method,
  devicePair.method,
  deviceAuthenticate.method,
  daemonShutdown.method,
] as const;

export const CLIENT_NOTIFICATION_METHODS = [sessionCancel.method] as const;

export const SERVER_NOTIFICATION_METHODS = [
  sessionUpdate.method,
  errorRaised.method,
  approvalCreated.method,
  approvalResolved.method,
] as const;

export type ClientRequestMethod = (typeof CLIENT_REQUEST_METHODS)[number];
export type ClientNotificationMethod =
  (typeof CLIENT_NOTIFICATION_METHODS)[number];
export type ServerNotificationMethod = (typeof SERVER_NOTIFICATION_METHODS)[number];
