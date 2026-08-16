import { z } from "zod";

export const IssueActorSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});

export const IssueLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
});

export const ExternalIssueRefSchema = z.object({
  provider: z.literal("github"),
  remoteKey: z.string(),
  issueId: z.string(),
  issueNumber: z.string().optional(),
});

export const IssueSummarySchema = z.object({
  ref: ExternalIssueRefSchema,
  title: z.string(),
  state: z.enum(["open", "closed"]),
  author: IssueActorSchema.optional(),
  assignees: z.array(IssueActorSchema),
  labels: z.array(IssueLabelSchema),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const IssueDetailSchema = IssueSummarySchema.extend({
  body: z.string().optional(),
});

export const IssueErrorSchema = z.object({
  kind: z.enum([
    "project-not-found",
    "not-configured",
    "missing-token",
    "unauthorized",
    "forbidden",
    "not-found",
    "rate-limited",
    "unavailable",
    "timeout",
    "network",
    "invalid-response",
  ]),
  message: z.string(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});
