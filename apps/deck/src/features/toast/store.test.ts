import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TOAST_DURATION_MS,
  TOAST_EXIT_ANIMATION_MS,
  toast,
  type ToastSnapshot,
} from "./store.js";

function delay(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function messages(snapshot: ToastSnapshot) {
  return snapshot.map((item) => item.message);
}

test("toast.success uses the default duration and returns the item id", () => {
  toast.clear();
  try {
    const id = toast.success("保存成功");
    const [item] = toast.getSnapshot();

    assert.equal(item?.id, id);
    assert.equal(item?.variant, "success");
    assert.equal(item?.duration, DEFAULT_TOAST_DURATION_MS);
    assert.equal(item?.state, "visible");
  } finally {
    toast.clear();
  }
});

test("custom duration is stored and manual dismiss removes after exit animation", async () => {
  toast.clear();
  try {
    const id = toast.error("保存失败", { duration: 50 });
    assert.equal(toast.getSnapshot()[0]?.duration, 50);

    toast.dismiss(id);
    assert.equal(toast.getSnapshot()[0]?.state, "exiting");

    await delay(TOAST_EXIT_ANIMATION_MS + 30);
    assert.deepEqual(toast.getSnapshot(), []);
  } finally {
    toast.clear();
  }
});

test("custom duration auto-dismisses after the exit animation", async () => {
  toast.clear();
  try {
    toast.warning("即将关闭", { duration: 80 });
    assert.equal(toast.getSnapshot()[0]?.state, "visible");

    await delay(140);
    assert.equal(toast.getSnapshot()[0]?.state, "exiting");

    await delay(TOAST_EXIT_ANIMATION_MS + 50);
    assert.deepEqual(toast.getSnapshot(), []);
  } finally {
    toast.clear();
  }
});

test("toast variants are recorded in stacking order", () => {
  toast.clear();
  try {
    toast.success("成功", { duration: 0 });
    toast.error("错误", { duration: 0 });
    toast.warning("警告", { duration: 0 });
    toast.info("提示", { duration: 0 });

    assert.deepEqual(
      toast.getSnapshot().map((item) => item.variant),
      ["success", "error", "warning", "info"],
    );
    assert.deepEqual(messages(toast.getSnapshot()), [
      "成功",
      "错误",
      "警告",
      "提示",
    ]);
  } finally {
    toast.clear();
  }
});

test("custom ids replace existing toasts at the newest stack position", () => {
  toast.clear();
  try {
    toast.info("第一版", { id: "same-id", duration: 0 });
    toast.success("保留", { duration: 0 });
    toast.error("第二版", { id: "same-id", duration: 0 });

    assert.deepEqual(messages(toast.getSnapshot()), ["保留", "第二版"]);
    assert.deepEqual(
      toast.getSnapshot().map((item) => item.variant),
      ["success", "error"],
    );
  } finally {
    toast.clear();
  }
});

test("dismiss targets an empty string id without clearing unrelated toasts", async () => {
  toast.clear();
  try {
    toast.info("空 id", { id: "", duration: 0 });
    toast.success("保留", { duration: 0 });

    toast.dismiss("");

    await delay(TOAST_EXIT_ANIMATION_MS + 50);
    assert.deepEqual(messages(toast.getSnapshot()), ["保留"]);
  } finally {
    toast.clear();
  }
});

test("listeners receive stack updates and can unsubscribe", () => {
  toast.clear();
  try {
    const updates: string[][] = [];
    const unsubscribe = toast.subscribe((items) => {
      updates.push(messages(items));
    });

    toast.info("第一条", { duration: 0 });
    toast.success("第二条", { duration: 0 });

    assert.deepEqual(updates, [["第一条"], ["第一条", "第二条"]]);

    unsubscribe();
    toast.warning("第三条", { duration: 0 });

    assert.deepEqual(updates, [["第一条"], ["第一条", "第二条"]]);
    assert.deepEqual(messages(toast.getSnapshot()), [
      "第一条",
      "第二条",
      "第三条",
    ]);
  } finally {
    toast.clear();
  }
});
