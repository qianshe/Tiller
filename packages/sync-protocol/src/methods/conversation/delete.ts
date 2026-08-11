import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "conversation/delete" as const;
export const ParamsSchema = z.object({
  id: z.string(),
  revision: z.number().int().nonnegative().optional(),
});
export const ResultSchema = z.object({ ok: z.boolean(), preparationId: z.string() });
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Delete a conversation preparation.",
});
