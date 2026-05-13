import { z } from "zod";
import type {
  AcpModelOption,
  AvailableCommand,
  SessionConfigOption,
  SessionReasoningEffort,
} from "@tiller/shared";
import { typedUnknown } from "../../schemas";
import { requestDescriptor } from "../descriptor";

export const DraftStateSchema = z.object({
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});

export const method = "session/draft" as const;
export const ParamsSchema = z.object({
  deckClientId: z.string(),
  projectId: z.string(),
  cwd: z.string(),
  agentId: z.string(),
  agentMode: z.string().optional(),
  model: z.string().optional(),
  reasoningEffort: typedUnknown<SessionReasoningEffort>().optional(),
});
export const ResultSchema = z.object({
  ok: z.boolean(),
  draftId: z.string().optional(),
  deckClientId: z.string(),
  projectId: z.string().optional(),
  workspacePath: z.string().optional(),
  providerId: z.string().optional(),
  scopeKey: z.string(),
  logicalScopeKey: z.string(),
  runtimeSessionId: z.string().optional(),
  state: DraftStateSchema.optional(),
  modelOptions: z.array(typedUnknown<AcpModelOption>()).optional(),
  configOptions: z.array(typedUnknown<SessionConfigOption>()).optional(),
  availableCommands: z.array(typedUnknown<AvailableCommand>()).optional(),
  createdAt: z.string().optional(),
  expiresAt: z.string().optional(),
  reused: z.boolean().optional(),
  message: z.string(),
  errorCode: z.enum([
    "DRAFT_CREATE_FAILED",
    "AGENT_NOT_FOUND",
    "WORKSPACE_NOT_FOUND",
    "ACP_SESSION_FAILED",
  ]).optional(),
});
export type Params = z.infer<typeof ParamsSchema>;
export type Result = z.infer<typeof ResultSchema>;
export const descriptor = requestDescriptor({
  kind: "request",
  method,
  paramsSchema: ParamsSchema,
  resultSchema: ResultSchema,
  description: "Create or reuse an ACP runtime draft for the selected agent scope.",
});
