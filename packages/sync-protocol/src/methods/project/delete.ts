import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "project/delete" as const;
export const ParamsSchema = z.object({ projectId: z.string() });
export const ResultSchema = z.object({
  ok: z.boolean(),
  projectId: z.string(),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Delete a project configuration.",
});
