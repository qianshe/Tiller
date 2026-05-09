import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "agent/delete" as const;
export const ParamsSchema = z.object({ providerId: z.string() });
export const ResultSchema = z.object({
  ok: z.boolean(),
  providerId: z.string(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Delete an ACP provider configuration.",
});
