import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MissionWorktreeList } from "./worktree-list.js";

test("MissionWorktreeList renders selected session worktree summaries first", () => {
  const html = renderToStaticMarkup(
    <MissionWorktreeList
      selectedSessionWorktreeItems={[
        {
          branchName: "feature/0.1.6",
          cwd: "D:/myProject/tools/Tiller",
          sessionCount: 1,
          sessionTitles: [],
        },
      ]}
      worktreeOptions={[]}
      selectedCwd={null}
      activeSessionCwd={null}
      agents={[]}
      onSelectCwd={() => undefined}
      onSelectDraftAgent={() => undefined}
    />,
  );

  assert.match(html, /feature\/0\.1\.6/);
  assert.match(html, /D:\/myProject\/tools\/Tiller/);
});

test("MissionWorktreeList renders empty state when no cwd is available", () => {
  const html = renderToStaticMarkup(
    <MissionWorktreeList
      selectedSessionWorktreeItems={[]}
      worktreeOptions={[]}
      selectedCwd={null}
      activeSessionCwd={null}
      agents={[]}
      onSelectCwd={() => undefined}
      onSelectDraftAgent={() => undefined}
    />,
  );

  assert.match(html, /当前选中会话暂无 cwd/);
});
