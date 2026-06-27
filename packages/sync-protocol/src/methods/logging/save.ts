import { z } from "zod";
import { requestDescriptor } from "../descriptor";
import { LoggingLevelSchema, LoggingSettingsSchema } from "./get";

export const method = "logging/save" as const;
export const ParamsSchema = z.object({
  logging: z.object({
    level: LoggingLevelSchema.optional(),
    format: z.string().optional(),
    acpTrace: z.string().optional(),
  }).optional(),
}).strict();
export const ResultSchema = z.object({
  logging: LoggingSettingsSchema,
  message: z.string(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Update Helm logging settings.",
});
