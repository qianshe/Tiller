import { z } from "zod";
import { EmptyParamsSchema } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "daemon/update/start" as const;
export const ParamsSchema = EmptyParamsSchema;
export const ResultSchema = z.object({
  status: z.enum(["up-to-date", "restarting"]),
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  message: z.string(),
}).strict();

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Start a one-shot Helm update and restart the current runtime.",
});
