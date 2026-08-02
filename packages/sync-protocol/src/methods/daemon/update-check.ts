import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "daemon/update/check" as const;

export const ParamsSchema = z.object({
  force: z.boolean().optional(),
}).strict();

export const ResultSchema = z.object({
  currentVersion: z.string(),
  latestVersion: z.string().optional(),
  updateAvailable: z.boolean(),
  canUpdate: z.boolean(),
  checkStatus: z.enum(["checked", "failed", "disabled", "unsupported"]),
  cannotUpdateReason: z.string().optional(),
  manualCommand: z.string().optional(),
  checkedAt: z.string().optional(),
}).strict();

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Check the installed Helm version against the stable npm release.",
});
