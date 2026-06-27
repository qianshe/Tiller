import type { HelmHandlerContext } from "../../handlers/context";

type CatalogState<THelm, TWorktree, TAgent, TProject> = {
  getHelms: () => THelm[];
  setHelms: (items: THelm[]) => void;
  getWorktrees: () => TWorktree[];
  setWorktrees: (items: TWorktree[]) => void;
  getAgents: () => TAgent[];
  setAgents: (items: TAgent[]) => void;
  getProjects: () => TProject[];
  setProjects: (items: TProject[]) => void;
};

export type HandlerCatalogContext = Pick<
  HelmHandlerContext,
  | "getHelms"
  | "setHelms"
  | "loadAvailableHelms"
  | "getWorktrees"
  | "setWorktrees"
  | "loadAvailableWorktrees"
  | "getAgents"
  | "setAgents"
  | "loadAvailableAgents"
  | "getProjects"
  | "setProjects"
  | "loadAvailableProjectsWithSemanticSummaries"
  | "readApprovalPolicy"
  | "saveApprovalPolicyRule"
>;

export type HandlerCatalogContextOptions<
  THelm,
  TWorktree,
  TAgent,
  TProject,
  TApprovalPolicy,
  TApprovalPolicyRule,
> = {
  configPath: string;
  contextState: CatalogState<THelm, TWorktree, TAgent, TProject>;
  loadAvailableHelms: () => THelm[];
  loadAvailableWorktrees: () => TWorktree[];
  listAvailableProviders: (configPath: string) => TAgent[];
  loadAvailableProjectsWithSemanticSummaries: () => Promise<TProject[]>;
  readApprovalPolicy: (configPath: string) => TApprovalPolicy;
  saveApprovalPolicyRule: (rule: TApprovalPolicyRule, configPath: string) => void;
};

export function createHandlerCatalogContext<
  THelm,
  TWorktree,
  TAgent,
  TProject,
  TApprovalPolicy,
  TApprovalPolicyRule,
>(
  options: HandlerCatalogContextOptions<
    THelm,
    TWorktree,
    TAgent,
    TProject,
    TApprovalPolicy,
    TApprovalPolicyRule
  >,
) {
  return {
    getHelms: options.contextState.getHelms,
    setHelms: options.contextState.setHelms,
    loadAvailableHelms: options.loadAvailableHelms,
    getWorktrees: options.contextState.getWorktrees,
    setWorktrees: options.contextState.setWorktrees,
    loadAvailableWorktrees: options.loadAvailableWorktrees,
    getAgents: options.contextState.getAgents,
    setAgents: options.contextState.setAgents,
    loadAvailableAgents: () => options.listAvailableProviders(options.configPath),
    getProjects: options.contextState.getProjects,
    setProjects: options.contextState.setProjects,
    loadAvailableProjectsWithSemanticSummaries: options.loadAvailableProjectsWithSemanticSummaries,
    readApprovalPolicy: () => options.readApprovalPolicy(options.configPath),
    saveApprovalPolicyRule: (rule: TApprovalPolicyRule) => {
      options.saveApprovalPolicyRule(rule, options.configPath);
    },
  };
}
