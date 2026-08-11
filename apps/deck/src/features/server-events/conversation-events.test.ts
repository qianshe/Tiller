import assert from "node:assert/strict";
import test from "node:test";
import type { ConversationPreparation } from "@tiller/shared";
import { useDeckStore } from "../../store";
import { applyConversationListResult, applyConversationUpdate } from "./conversation-events";

const helmKey = "127.0.0.1:47631";
const preparation = (revision: number): ConversationPreparation => ({
  id: "preparation-1",
  content: `revision ${revision}`,
  revision,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: `2026-08-11T00:00:0${revision}.000Z`,
});

test("conversation list and global updates stay scoped to their Helm and ignore stale revisions", () => {
  useDeckStore.setState({ helmInventories: {} });
  assert.equal(applyConversationListResult("conversation/list", { preparations: [preparation(2)] }, helmKey), true);
  applyConversationUpdate(helmKey, { kind: "preparation_updated", preparation: preparation(1) });
  assert.equal(useDeckStore.getState().helmInventories[helmKey]?.preparations?.[0]?.revision, 2);

  applyConversationUpdate(helmKey, { kind: "preparation_updated", preparation: preparation(3) });
  assert.equal(useDeckStore.getState().helmInventories[helmKey]?.preparations?.[0]?.revision, 3);
  assert.deepEqual(useDeckStore.getState().sessions, []);

  applyConversationUpdate(helmKey, { kind: "preparation_deleted", preparationId: preparation(3).id });
  assert.deepEqual(useDeckStore.getState().helmInventories[helmKey]?.preparations, []);
});
