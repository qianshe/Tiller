import assert from "node:assert/strict";
import test from "node:test";
import {
  moveMissionPanelPageInList,
  readMissionPanelPages,
  reorderMissionPanelPage,
  writeMissionPanelPages,
} from "./panel-pages.js";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withStorage(run: () => void) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: new MemoryStorage(),
  } as unknown as Window & typeof globalThis;
  try {
    run();
  } finally {
    globalThis.window = previousWindow;
  }
}

test("mission panel pages persist and sanitize stored records", () => {
  withStorage(() => {
    writeMissionPanelPages([{ id: "display", title: "展示" }]);

    assert.deepEqual(readMissionPanelPages(), [
      { id: "display", title: "展示" },
    ]);
  });
});

test("mission panel page moving rejects missing or out-of-range pages", () => {
  const pages = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
  ];

  assert.equal(moveMissionPanelPageInList(pages, "missing", 1), pages);
  assert.equal(moveMissionPanelPageInList(pages, "a", -1), pages);
});

test("mission panel pages can be reordered by target id", () => {
  const pages = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" },
  ];

  assert.deepEqual(
    reorderMissionPanelPage(pages, "c", "a").map((page) => page.id),
    ["c", "a", "b"],
  );
});
