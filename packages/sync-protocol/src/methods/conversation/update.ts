import { z } from "zod";
import type { ConversationPreparation } from "@tiller/domain-contracts";
import { typedUnknown } from "../../schemas";
import { notificationDescriptor } from "../descriptor";

export const method = "conversation/update" as const;
export const ParamsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("preparation_updated"),
    preparation: typedUnknown<ConversationPreparation>(),
  }),
  z.object({
    kind: z.literal("preparation_deleted"),
    preparationId: z.string(),
  }),
]);
export type Params = z.infer<typeof ParamsSchema>;
export const descriptor = notificationDescriptor({
  kind: "notification",
  method,
  paramsSchema: ParamsSchema,
  description: "Broadcast a Helm-owned conversation preparation change.",
});
