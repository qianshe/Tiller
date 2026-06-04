import assert from "node:assert/strict";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectInventorySection } from "./project-inventory-section";

function findElementById<T extends { id?: string }>(
  node: ReactNode,
  id: string,
): ReactElement<T> {
  if (!isValidElement(node)) {
    throw new Error(`Element ${id} not found`);
  }

  const element = node as ReactElement<T & { children?: ReactNode }>;
  if (element.props.id === id) {
    return element as ReactElement<T>;
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
        return findElementById<T>(child, id);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes(`Element ${id} not found`)) {
          throw error;
        }
      }
    }
  }

  throw new Error(`Element ${id} not found`);
}

test("ProjectInventorySection renders a summary file input with candidates", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{ id: "project-1", name: "Tiller", path: "D:/repo", summaryFile: "AGENTS.md" }}
      formOpen={true}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{ id: "project-1", name: "Tiller", helmId: "local-helm", path: "D:/repo" }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={[]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[{ path: "AGENTS.md", kind: "file" }]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.match(html, /摘要文件/u);
  assert.match(html, /AGENTS\.md/u);
});

test("ProjectInventorySection hides summary file input while creating a project", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{ name: "", path: "", summaryFile: "" }}
      formOpen={true}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{ id: "project-1", name: "Tiller", helmId: "local-helm", path: "D:/repo" }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={[]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[{ path: "AGENTS.md", kind: "file" }]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.doesNotMatch(html, /fleet-project-summary-file/u);
});

test("ProjectInventorySection renders directory candidates returned by Helm", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{ name: "", path: "", summaryFile: "" }}
      formOpen={true}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{
        id: "project-1",
        name: "Tiller",
        helmId: "local-helm",
        path: "D:/repo",
        worktrees: [{ name: "feature", path: "D:/repo-feature", kind: "git-worktree" }],
      }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[{ name: "root", path: "D:/repo-root", kind: "root" }]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={["D:/order", "D:/projects"]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.match(html, /fleet-project-path-options/u);
  assert.match(html, /D:\/order/u);
  assert.match(html, /D:\/projects/u);
  assert.doesNotMatch(html, /D:\/repo-feature/u);
  assert.doesNotMatch(html, /D:\/repo-root/u);
});

test("ProjectInventorySection renders only markdown-like file candidates", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{ id: "project-1", name: "Tiller", path: "D:/repo", summaryFile: "" }}
      formOpen={true}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{ id: "project-1", name: "Tiller", helmId: "local-helm", path: "D:/repo" }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={[]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[
        { path: "src/index.ts", kind: "file" },
        { path: "docs", kind: "directory" },
        { path: "AGENTS.md", kind: "file" },
        { path: "docs/context.md", kind: "file" },
      ]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.match(html, /AGENTS\.md/u);
  assert.match(html, /docs\/context\.md/u);
  assert.doesNotMatch(html, /src\/index\.ts/u);
  assert.doesNotMatch(html, /value="docs"/u);
});

test("ProjectInventorySection shows the configured summary file in project details", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{ name: "", path: "", summaryFile: "" }}
      formOpen={false}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{
        id: "project-1",
        name: "Tiller",
        helmId: "local-helm",
        path: "D:/repo",
        summaryFile: "docs/context.md",
      }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={[]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.match(html, /Summary File/u);
  assert.match(html, /docs\/context\.md/u);
});

test("ProjectInventorySection shows the default summary source when unset", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{ name: "", path: "", summaryFile: "" }}
      formOpen={false}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{ id: "project-1", name: "Tiller", helmId: "local-helm", path: "D:/repo" }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={[]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.match(html, /默认：AGENTS\.md \/ CLAUDE\.md \/ README\.md/u);
});

test("ProjectInventorySection previews edited project fields before saving", () => {
  const html = renderToStaticMarkup(
    <ProjectInventorySection
      connected={true}
      dispatch={async () => undefined}
      draft={{
        id: "project-1",
        name: "Tiller Edited",
        path: "D:/repo-edited",
        summaryFile: "docs/context.md",
      }}
      formOpen={true}
      selectedHelmAgents={[]}
      selectedHelmId="local-helm"
      selectedHelmProjects={[{
        id: "project-1",
        name: "Tiller",
        helmId: "local-helm",
        path: "D:/repo",
        summaryFile: "AGENTS.md",
      }]}
      selectedHelmRpcClient={{} as any}
      selectedHelmWorktrees={[]}
      setDraft={() => undefined}
      setFormOpen={() => undefined}
      setSaveMessage={() => undefined}
      projectPathCandidates={[]}
      requestProjectPathCandidates={() => undefined}
      summaryFileCandidates={[]}
      requestSummaryFileCandidates={() => undefined}
    />,
  );

  assert.match(html, /Tiller Edited/u);
  assert.match(html, /D:\/repo-edited/u);
  assert.match(html, /docs\/context\.md/u);
});

test("ProjectInventorySection requests summary file candidates on edit input activation", () => {
  const project = { id: "project-1", name: "Tiller", helmId: "local-helm", path: "D:/repo" };
  const requestedProjects: Array<{ id: string; path?: string }> = [];
  const tree = ProjectInventorySection({
    connected: true,
    dispatch: async () => undefined,
    draft: { id: project.id, name: project.name, path: "D:/repo-edited", summaryFile: "" },
    formOpen: true,
    selectedHelmAgents: [],
    selectedHelmId: "local-helm",
    selectedHelmProjects: [project],
    selectedHelmRpcClient: {} as any,
    selectedHelmWorktrees: [],
    setDraft: () => undefined,
    setFormOpen: () => undefined,
    setSaveMessage: () => undefined,
    projectPathCandidates: [],
    requestProjectPathCandidates: () => undefined,
    summaryFileCandidates: [],
    requestSummaryFileCandidates: (candidateProject) => {
      requestedProjects.push({ id: candidateProject.id, path: candidateProject.path });
    },
  });

  const input = findElementById<{
    id?: string;
    onClick?: () => void;
    onFocus?: () => void;
  }>(
    tree,
    "fleet-project-summary-file",
  );
  input.props.onClick?.();
  input.props.onFocus?.();

  assert.deepEqual(requestedProjects, [
    { id: project.id, path: "D:/repo-edited" },
    { id: project.id, path: "D:/repo-edited" },
  ]);
});

test("ProjectInventorySection requests path candidates from the current input", () => {
  const requestedPaths: string[] = [];
  let nextDraft = { name: "", path: "D:/or", summaryFile: "" };
  const tree = ProjectInventorySection({
    connected: true,
    dispatch: async () => undefined,
    draft: nextDraft,
    formOpen: true,
    selectedHelmAgents: [],
    selectedHelmId: "local-helm",
    selectedHelmProjects: [],
    selectedHelmRpcClient: {} as any,
    selectedHelmWorktrees: [],
    setDraft: (value) => {
      nextDraft = typeof value === "function" ? value(nextDraft) : value;
    },
    setFormOpen: () => undefined,
    setSaveMessage: () => undefined,
    projectPathCandidates: [],
    requestProjectPathCandidates: (path) => {
      requestedPaths.push(path);
    },
    summaryFileCandidates: [],
    requestSummaryFileCandidates: () => undefined,
  });

  const input = findElementById<{
    id?: string;
    onFocus?: () => void;
    onChange?: (event: { target: { value: string } }) => void;
  }>(
    tree,
    "fleet-project-path",
  );
  input.props.onFocus?.();
  input.props.onChange?.({ target: { value: "D:/order" } });

  assert.deepEqual(requestedPaths, ["D:/or", "D:/order"]);
  assert.equal(nextDraft.path, "D:/order");
});
