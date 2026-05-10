import assert from "node:assert/strict";
import test from "node:test";
import { createClipboardImageContent, extractClipboardImageItems, formatClipboardImageNotice } from "./clipboard.js";

function fakeImageFile(name: string, type: string, size: number) {
  return { name, type, size } as File;
}

test("extractClipboardImageItems returns image files from paste clipboard data", () => {
  const image = fakeImageFile("screenshot.png", "image/png", 2048);
  const items = [
    { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "image/png", getAsFile: () => image },
  ];

  assert.deepEqual(extractClipboardImageItems({ items }), [image]);
});

test("extractClipboardImageItems ignores non-image file clipboard data", () => {
  const items = [
    { kind: "file", type: "text/plain", getAsFile: () => fakeImageFile("notes.txt", "text/plain", 12) },
  ];

  assert.deepEqual(extractClipboardImageItems({ items }), []);
});

test("formatClipboardImageNotice explains that pasted images will be sent as ACP image content", () => {
  assert.equal(
    formatClipboardImageNotice([fakeImageFile("shot.png", "image/png", 1536)]),
    "已添加图片：shot.png（image/png，1.5 KB）。发送时会作为 ACP image content 随提示词传输。",
  );
});

test("createClipboardImageContent encodes pasted files as ACP image content", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });

  assert.deepEqual(await createClipboardImageContent(file, 0), {
    type: "image",
    data: "AQID",
    mimeType: "image/png",
    name: "shot.png",
    uri: "tiller:///agent/prompt-image?name=shot.png&index=0",
  });
});
