import { z } from "zod";
import { requestDescriptor } from "../descriptor";

export const method = "notification/clear" as const;

export const ParamsSchema = z.object({});

export const ResultSchema = z.object({
  ok: z.boolean(),
  clearedAt: z.string(),
});

export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;

export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Clear persisted Helm notifications for all connected clients.",
});
