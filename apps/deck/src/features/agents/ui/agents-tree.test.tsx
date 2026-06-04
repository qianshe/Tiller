import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AgentsTree,
  resolveNextAgentsTreeHelmExpansion,
} from "./agents-tree";

const helmCards = [
  { key: "local", name: "Local Helm", host: "localhost", port: "47631", isCurrent: true, profile: null },
  { key: "remote", name: "Remote Helm", host: "192.168.1.2", port: "47631", isCurrent: false, profile: null },
];
const selectedHelm = helmCards[0]!;

test("resolveNextAgentsTreeHelmExpansion collapses the selected expanded Helm", () => {
  const next = resolveNextAgentsTreeHelmExpansion(new Set(["local"]), "local", "local");

  assert.deepEqual([...next], []);
});

test("resolveNextAgentsTreeHelmExpansion expands a newly selected Helm", () => {
  const next = resolveNextAgentsTreeHelmExpansion(new Set(["local"]), "remote", "local");

  assert.deepEqual([...next].sort(), ["local", "remote"]);
});

test("AgentsTree keeps a single footer add Helm entry in the desktop sidebar", () => {
  const html = renderToStaticMarkup(
    <AgentsTree
      connection="connected"
      currentHelmKey="local"
      helmCards={helmCards}
      helmConnectionStates={{}}
      helmInventories={{
        local: { agents: [], projects: [], sessions: [], trustedDevices: [], worktrees: [] },
        remote: { agents: [], projects: [], sessions: [], trustedDevices: [], worktrees: [] },
      }}
      isEmbeddedHelmDeck={false}
      onAddHelm={() => undefined}
      selectedHelm={selectedHelm}
      selectedHelmCounts={{ agents: 0, projects: 0, worktrees: 0 }}
      setSelectedHelmKey={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /title="添加 Helm"/u);
  assert.equal((html.match(/配对新 Helm/gu) ?? []).length, 1);
});
