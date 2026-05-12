import { z } from "zod";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "session/discard_draft" as const;
export const ParamsSchema = z.object({
  deckClientId: z.string(),
  draftId: z.string().optional(),
  scopeKey: z.string().optional(),
  reason: z.enum(["scope-change", "tab-disconnect", "ttl", "shutdown", "user"]),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  discarded: z.boolean(),
  draftId: z.string().optional(),
  cleanup: typedUnknown<unknown>().optional(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Discard an unused ACP runtime draft.",
});
