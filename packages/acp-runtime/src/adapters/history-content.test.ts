import assert from "node:assert/strict";
import test from "node:test";
import { collectHistoryImageAttachments } from "./history-content.js";

test("collectHistoryImageAttachments extracts common provider image parts", () => {
  const attachments = collectHistoryImageAttachments(
    [
      {
        type: "image",
        source: {
          media_type: "image/png",
          data: "png-base64",
        },
      },
      {
        type: "image_url",
        image_url: {
          url: "data:image/jpeg;base64,jpeg-base64",
        },
      },
      {
        type: "input_image",
        imageUrl: "data:image/webp;base64,webp-base64",
        name: "screen.webp",
      },
    ],
    "msg-user",
  );

  assert.deepEqual(attachments, [
    {
      type: "image",
      data: "png-base64",
      mimeType: "image/png",
      name: "msg-user-image-1.png",
    },
    {
      type: "image",
      data: "jpeg-base64",
      mimeType: "image/jpeg",
      name: "msg-user-image-2.jpg",
    },
    {
      type: "image",
      data: "webp-base64",
      mimeType: "image/webp",
      name: "screen.webp",
    },
  ]);
});
