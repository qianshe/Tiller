import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { AcpAgentProvider, ProjectSummary } from "@tiller/shared";
import { AgentInventorySection, type FleetAgentDraft } from "./agent-inventory-section";
import { ProjectInventorySection, type FleetProjectDraft } from "./project-inventory-section";

function findButtonByText(node: ReactNode, text: string): ReactElement<{ onClick?: () => void }> {
  if (!isValidElement(node)) {
    throw new Error(`Button ${text} not found`);
  }

  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (element.props.children === text && typeof element.props.onClick === "function") {
    return element as ReactElement<{ onClick?: () => void }>;
  }

  const children = element.props.children;
  const candidates = Array.isArray(children) ? children : [children];
  for (const child of candidates) {
    if (isValidElement(child)) {
      try {
        return findButtonByText(child, text);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes(`Button ${text} not found`)) {
          throw error;
        }
      }
    }
  }

  throw new Error(`Button ${text} not found`);
}

const dispatch = async () => undefined;
const project: ProjectSummary = {
  id: "project-1",
  name: "Original Project",
  helmId: "helm-1",
  path: "D:/projects/original",
};
const agent: AcpAgentProvider = {
  id: "agent-1",
  name: "Original Agent",
  command: "codex",
  args: ["acp"],
  transport: "stdio",
  protocol: "acp",
};

test("ProjectInventorySection shows cancel action while editing", () => {
  const html = renderToString(
    <ProjectInventorySection
      connected
      dispatch={dispatch}
      draft={{ id: project.id, name: project.name, path: project.path ?? "" }}
      formOpen
      selectedHelmAgents={[]}
      selectedHelmId="helm-1"
      selectedHelmProjects={[project]}
      selectedHelmRpcClient={null}
      selectedHelmWorkspaces={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
    />,
  );

  assert.match(html, /取消/);
});

test("ProjectInventorySection cancel closes form and discards edited draft", () => {
  let nextDraft: FleetProjectDraft | undefined;
  let nextFormOpen: boolean | undefined;
  const tree = ProjectInventorySection({
    connected: true,
    dispatch,
    draft: { id: project.id, name: "Unsaved Project", path: "D:/changed" },
    formOpen: true,
    selectedHelmAgents: [],
    selectedHelmId: "helm-1",
    selectedHelmProjects: [project],
    selectedHelmRpcClient: null,
    selectedHelmWorkspaces: [],
    setDraft: (value) => {
      nextDraft = typeof value === "function" ? value({ name: "", path: "" }) : value;
    },
    setFormOpen: (value) => {
      nextFormOpen = typeof value === "function" ? value(true) : value;
    },
    setSaveMessage: () => undefined,
  });

  findButtonByText(tree, "取消").props.onClick?.();

  assert.deepEqual(nextDraft, { name: "", path: "" });
  assert.equal(nextFormOpen, false);
});

test("AgentInventorySection cancel closes form and discards edited draft", () => {
  let nextDraft: FleetAgentDraft | undefined;
  let nextFormOpen: boolean | undefined;
  const tree = AgentInventorySection({
    connected: true,
    dispatch,
    draft: { id: agent.id, name: "Unsaved Agent", command: "changed", args: ["--draft"] },
    emptyLabel: "No agents",
    formOpen: true,
    selectedHelmAgents: [agent],
    selectedHelmRpcClient: null,
    setDraft: (value) => {
      nextDraft = typeof value === "function" ? value({ name: "", command: "", args: [""] }) : value;
    },
    setFormOpen: (value) => {
      nextFormOpen = typeof value === "function" ? value(true) : value;
    },
  });

  findButtonByText(tree, "取消").props.onClick?.();

  assert.deepEqual(nextDraft, { name: "", command: "", args: [""] });
  assert.equal(nextFormOpen, false);
});
