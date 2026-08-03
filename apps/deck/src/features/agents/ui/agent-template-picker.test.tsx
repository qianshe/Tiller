import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import type { AcpAgentProvider } from "@tiller/shared";
import { AgentInventorySection, type FleetAgentDraft } from "./agent-inventory-section";

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
  for (const child of [
    ...candidates,
    ...Object.entries(element.props)
      .filter(([key]) => key !== "children")
      .flatMap(([, value]) => Array.isArray(value) ? value : [value]),
  ]) {
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
const agent: AcpAgentProvider = {
  id: "agent-1",
  name: "Original Agent",
  command: "codex",
  args: ["acp"],
  transport: "stdio",
  protocol: "acp",
};

test("AgentInventorySection shows template chips only when adding a new agent", () => {
  const html = renderToString(
    <AgentInventorySection
      connected
      dispatch={dispatch}
      draft={{ name: "", command: "", args: [""] }}
      emptyLabel="No agents"
      formOpen
      selectedHelmAgents={[agent]}
      selectedHelmRpcClient={null}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
    />,
  );

  assert.match(html, /常用 ACP 模板/);
  assert.match(html, /Codex CLI/);
  assert.match(html, /Claude Code/);
  assert.match(html, /OpenCode/);
});

test("AgentInventorySection hides template chips while editing an existing agent", () => {
  const html = renderToString(
    <AgentInventorySection
      connected
      dispatch={dispatch}
      draft={{ id: agent.id, name: agent.name, command: agent.command, args: ["acp"] }}
      emptyLabel="No agents"
      formOpen
      selectedHelmAgents={[agent]}
      selectedHelmRpcClient={null}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /常用 ACP 模板/);
});

test("AgentInventorySection clicking a template prefills the draft", () => {
  let nextDraft: FleetAgentDraft | undefined;
  const tree = AgentInventorySection({
    connected: true,
    dispatch,
    draft: { name: "", command: "", args: [""] },
    emptyLabel: "No agents",
    formOpen: true,
    selectedHelmAgents: [],
    selectedHelmRpcClient: null,
    setDraft: (value) => {
      nextDraft = typeof value === "function" ? value({ name: "", command: "", args: [""] }) : value;
    },
    setFormOpen: () => undefined,
  });

  findButtonByText(tree, "Claude Code").props.onClick?.();

  assert.deepEqual(nextDraft, {
    name: "Claude Code",
    command: "claude-agent-acp",
    args: [],
  });
});

test("AgentInventorySection shows install hint matching the current command", () => {
  const html = renderToString(
    <AgentInventorySection
      connected
      dispatch={dispatch}
      draft={{ name: "", command: "opencode", args: ["acp"] }}
      emptyLabel="No agents"
      formOpen
      selectedHelmAgents={[]}
      selectedHelmRpcClient={null}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
    />,
  );

  assert.match(html, /安装提示/);
  assert.match(html, /opencode-ai/);
});

test("AgentInventorySection hides install hint for unknown commands", () => {
  const html = renderToString(
    <AgentInventorySection
      connected
      dispatch={dispatch}
      draft={{ name: "", command: "gemini", args: [""] }}
      emptyLabel="No agents"
      formOpen
      selectedHelmAgents={[]}
      selectedHelmRpcClient={null}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /安装提示/);
});
