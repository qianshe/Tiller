import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionOnboardingEmpty } from "./onboarding-empty.js";

function renderOnboarding(
  overrides: Partial<{
    helmConnected: boolean;
    hasAgents: boolean;
    hasProjects: boolean;
    onNavigateAgents: (tab: "agents" | "projects") => void;
  }> = {},
) {
  return renderToStaticMarkup(
    <MissionOnboardingEmpty
      helmConnected={overrides.helmConnected ?? true}
      hasAgents={overrides.hasAgents ?? false}
      hasProjects={overrides.hasProjects ?? false}
      onNavigateAgents={overrides.onNavigateAgents ?? (() => undefined)}
    />,
  );
}

test("renders both pending steps with 前往舰队 buttons when nothing is configured", () => {
  const html = renderOnboarding();

  assert.match(html, /工作台引导/u);
  assert.match(html, /配置 ACP Agent/u);
  assert.match(html, /添加项目路径/u);
  assert.match(html, />前往舰队 →</u);
  assert.equal(html.match(/>前往舰队 →</gu)?.length, 2);
  // no check icons when both steps are pending
  assert.doesNotMatch(html, /text-success/u);
});

test("shows completed state on step ① when agents are configured, button remains", () => {
  const html = renderOnboarding({ hasAgents: true });

  assert.match(html, />已配置，前往调整 →</u);
  assert.match(html, /text-success/u);
  // project step still pending
  assert.match(html, />前往舰队 →</u);
});

test("shows completed state on step ② when projects are configured", () => {
  const html = renderOnboarding({ hasProjects: true });

  assert.match(html, />已配置，前往调整 →</u);
  assert.match(html, /text-success/u);
});

test("renders nothing when both steps are complete", () => {
  const html = renderOnboarding({ hasAgents: true, hasProjects: true });

  assert.equal(html, "");
});

test("renders a helm-disconnected hint without steps when helm is disconnected", () => {
  const html = renderOnboarding({ helmConnected: false });

  assert.match(html, /Helm 未连接/u);
  assert.doesNotMatch(html, /配置 ACP Agent/u);
  assert.doesNotMatch(html, />前往舰队 →</u);
});

test("routes each onboarding step to its corresponding agents tab", () => {
  const calls: Array<"agents" | "projects"> = [];
  const tree = MissionOnboardingEmpty({
    helmConnected: true,
    hasAgents: false,
    hasProjects: false,
    onNavigateAgents: (tab) => calls.push(tab),
  });
  const steps = findOnboardingSteps(tree);

  assert.equal(steps.length, 2);
  steps[0]?.props.onAction();
  steps[1]?.props.onAction();
  assert.deepEqual(calls, ["agents", "projects"]);
});

function findOnboardingSteps(node: ReactNode): Array<ReactElement<{ onAction: () => void }>> {
  if (!isValidElement(node)) {
    return [];
  }
  const props = node.props as { children?: ReactNode; onAction?: () => void };
  const children = Array.isArray(props.children) ? props.children : [props.children];
  return [
    ...(typeof props.onAction === "function"
      ? [node as ReactElement<{ onAction: () => void }>]
      : []),
    ...children.flatMap((child) => findOnboardingSteps(child)),
  ];
}
