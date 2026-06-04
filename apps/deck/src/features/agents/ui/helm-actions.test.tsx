import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { HelmActions } from "./helm-actions";

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
    if (!isValidElement(child)) {
      continue;
    }
    try {
      return findButtonByText(child, text);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes(`Button ${text} not found`)) {
        throw error;
      }
    }
  }

  throw new Error(`Button ${text} not found`);
}

function createActions(overrides: Partial<Parameters<typeof HelmActions>[0]> = {}) {
  const socketRef = { current: null };
  return HelmActions({
    connectDaemonProfile: () => undefined,
    connectToDaemon: () => undefined,
    dispatch: async () => undefined,
    helmSocketRefs: { current: new Map() },
    isEmbeddedHelmDeck: false,
    lastFilesScopeKeyRef: { current: null },
    manualDisconnectRef: { current: null },
    selectedHelm: {
      key: "127.0.0.1:47631",
      name: "Local Helm",
      host: "127.0.0.1",
      port: "47631",
      isCurrent: true,
      profile: null,
    },
    selectedHelmConnection: "connected",
    selectedHelmIsConnected: true,
    selectedHelmIsCurrent: true,
    selectedHelmRpcClient: { request: async () => ({}), notify: () => undefined, close: () => undefined } as any,
    selectedHelmSavedProfile: null,
    setConnection: () => undefined,
    setHelmConnectionState: () => undefined,
    setPendingHelmDeleteProfile: () => undefined,
    socketRef,
    ...overrides,
  });
}

test("HelmActions shows explicit shutdown when connected", () => {
  const html = renderToString(createActions());

  assert.match(html, /关闭 Helm/);
});

test("HelmActions renders connected controls as a compact header group", () => {
  const html = renderToString(createActions());

  assert.match(html, /aria-label="Helm 连接操作"/u);
  assert.match(html, /border-l border-border-ghost/);
  assert.match(html, /h-\[var\(--control-h-sm\)\]/);
});

test("HelmActions sends daemon shutdown before marking Helm disconnected", async () => {
  const calls: string[] = [];
  const tree = createActions({
    dispatch: async (_client, method) => {
      calls.push(method);
    },
    setConnection: (state) => {
      calls.push(`connection:${typeof state === "function" ? "updater" : state}`);
    },
    setHelmConnectionState: (_key, state) => {
      calls.push(`helm:${state}`);
    },
  });

  const button = findButtonByText(tree, "关闭 Helm");
  await button.props.onClick?.();

  assert.deepEqual(calls, ["daemon/shutdown", "connection:disconnected", "helm:disconnected"]);
});
