import type { z } from "zod";
import type { NotificationDescriptor, RequestDescriptor } from "./descriptor";
import * as helmList from "./helm/list";
import * as helmSave from "./helm/save";
import * as projectList from "./project/list";
import * as projectListFiles from "./project/list-files";
import * as projectSave from "./project/save";
import * as projectDelete from "./project/delete";
import * as workspaceList from "./workspace/list";
import * as workspaceSave from "./workspace/save";
import * as workspaceGitListBranches from "./workspace/git/list-branches";
import * as workspaceGitCreateBranch from "./workspace/git/create-branch";
import * as agentList from "./agent/list";
import * as agentTest from "./agent/test";
import * as agentReconnect from "./agent/reconnect";
import * as agentGetModelOptions from "./agent/get-model-options";
import * as agentSave from "./agent/save";
import * as agentDelete from "./agent/delete";
import * as sessionNew from "./session/new";
import * as sessionPrewarm from "./session/prewarm";
import * as sessionList from "./session/list";
import * as sessionListMessages from "./session/list-messages";
import * as sessionGetArtifacts from "./session/get-artifacts";
import * as sessionCheckResume from "./session/check-resume";
import * as sessionResume from "./session/resume";
import * as sessionPrompt from "./session/prompt";
import * as sessionSetConfigOption from "./session/set-config-option";
import * as sessionCleanup from "./session/cleanup";
import * as permissionListPending from "./permission/list-pending";
import * as permissionRespond from "./permission/respond";
import * as deviceList from "./device/list";
import * as deviceRevoke from "./device/revoke";
import * as devicePair from "./device/pair";
import * as deviceAuthenticate from "./device/authenticate";
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
  [projectSave.method]: projectSave.descriptor,
  [projectDelete.method]: projectDelete.descriptor,
  [workspaceList.method]: workspaceList.descriptor,
  [workspaceSave.method]: workspaceSave.descriptor,
  [workspaceGitListBranches.method]: workspaceGitListBranches.descriptor,
  [workspaceGitCreateBranch.method]: workspaceGitCreateBranch.descriptor,
  [agentList.method]: agentList.descriptor,
  [agentTest.method]: agentTest.descriptor,
  [agentReconnect.method]: agentReconnect.descriptor,
  [agentGetModelOptions.method]: agentGetModelOptions.descriptor,
  [agentSave.method]: agentSave.descriptor,
  [agentDelete.method]: agentDelete.descriptor,
  [sessionNew.method]: sessionNew.descriptor,
  [sessionPrewarm.method]: sessionPrewarm.descriptor,
  [sessionList.method]: sessionList.descriptor,
  [sessionListMessages.method]: sessionListMessages.descriptor,
  [sessionGetArtifacts.method]: sessionGetArtifacts.descriptor,
  [sessionCheckResume.method]: sessionCheckResume.descriptor,
  [sessionResume.method]: sessionResume.descriptor,
  [sessionPrompt.method]: sessionPrompt.descriptor,
  [sessionSetConfigOption.method]: sessionSetConfigOption.descriptor,
  [sessionRename.method]: sessionRename.descriptor,
  [sessionCleanup.method]: sessionCleanup.descriptor,
  [permissionListPending.method]: permissionListPending.descriptor,
  [permissionRespond.method]: permissionRespond.descriptor,
  [deviceList.method]: deviceList.descriptor,
  [deviceRevoke.method]: deviceRevoke.descriptor,
  [devicePair.method]: devicePair.descriptor,
  [deviceAuthenticate.method]: deviceAuthenticate.descriptor,
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
  projectSave.method,
  projectDelete.method,
  workspaceList.method,
  workspaceSave.method,
  workspaceGitListBranches.method,
  workspaceGitCreateBranch.method,
  agentList.method,
  agentTest.method,
  agentReconnect.method,
  agentGetModelOptions.method,
  agentSave.method,
  agentDelete.method,
  sessionNew.method,
  sessionPrewarm.method,
  sessionList.method,
  sessionListMessages.method,
  sessionGetArtifacts.method,
  sessionCheckResume.method,
  sessionResume.method,
  sessionPrompt.method,
  sessionSetConfigOption.method,
  sessionRename.method,
  sessionCleanup.method,
  permissionListPending.method,
  permissionRespond.method,
  deviceList.method,
  deviceRevoke.method,
  devicePair.method,
  deviceAuthenticate.method,
] as const;

export const CLIENT_NOTIFICATION_METHODS = [sessionCancel.method] as const;

export const SERVER_NOTIFICATION_METHODS = [
  sessionUpdate.method,
  errorRaised.method,
] as const;

export type ClientRequestMethod = (typeof CLIENT_REQUEST_METHODS)[number];
export type ClientNotificationMethod =
  (typeof CLIENT_NOTIFICATION_METHODS)[number];
export type ServerNotificationMethod =
  (typeof SERVER_NOTIFICATION_METHODS)[number];
