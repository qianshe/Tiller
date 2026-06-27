import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "react-dom/server";
import { InventoryTable } from "./inventory-table";

test("InventoryTable renders compact rows with optional details and actions", () => {
  const html = renderToString(
    <InventoryTable
      title="工作区"
      countLabel="2"
      rows={[
        {
          key: "root",
          title: "feature/0.1.6",
          subtitle: "D:/myProject/tools/Tiller",
          badge: <span>工作区</span>,
        },
        {
          key: "codex",
          title: "Codex",
          subtitle: "codex-acp",
          details: <dl><dt>Command</dt><dd>codex-acp</dd></dl>,
          actions: <button type="button">编辑</button>,
        },
      ]}
      emptyLabel="暂无数据"
    />,
  );

  assert.match(html, /工作区/);
  assert.match(html, /feature\/0\.1\.6/);
  assert.match(html, /D:\/myProject\/tools\/Tiller/);
  assert.match(html, /<details/);
  assert.match(html, /编辑/);
  assert.match(html, /wb-pane-sunken/);
});
