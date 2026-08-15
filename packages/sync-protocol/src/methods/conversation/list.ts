import { z } from "zod";
import type { ConversationPreparation } from "@tiller/domain-contracts";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "conversation/list" as const;
export const ParamsSchema = z.object({});
export const ResultSchema = z.object({
  preparations: z.array(typedUnknown<ConversationPreparation>()),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List conversation preparations stored by this Helm.",
});
