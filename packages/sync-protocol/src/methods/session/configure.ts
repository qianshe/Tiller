import { requestDescriptor } from "../descriptor";
import {
  ConfigStateSchema,
  ParamsSchema,
  ResultSchema,
  type Params,
  type Result,
} from "./set-config-option";

export { ConfigStateSchema, ParamsSchema, ResultSchema };
export type { Params, Result };

export const method = "session/configure" as const;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Configure an active session or runtime draft.",
});
