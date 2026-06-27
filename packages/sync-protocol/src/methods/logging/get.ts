import { z } from "zod";
import { EmptyParamsSchema } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const method = "logging/get" as const;
export const ParamsSchema = EmptyParamsSchema;
export const LoggingLevelSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);
export const LoggingSettingsSchema = z.object({
  level: LoggingLevelSchema,
  format: z.string(),
  acpTrace: z.string(),
});
export const ResultSchema = z.object({
  logging: LoggingSettingsSchema,
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Read Helm logging settings.",
});
