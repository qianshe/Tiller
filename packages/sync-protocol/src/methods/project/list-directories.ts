import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "project/list_directories" as const;
export const ParamsSchema = z.object({
  path: z.string().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional(),
  directories: z.array(z.string()),
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "List local directory candidates for a project path input.",
});
