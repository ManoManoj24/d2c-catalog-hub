import type { AttributeDefinition, ChannelSpec, FieldBag, Picklist, RelationshipRule, TaxSchedule } from "../types";
import { channelReadiness, scoreCompleteness } from "./completeness";
import { validateFlatRecord } from "./validate";

export type QualityCache = {
  completenessPct: number;
  missing: string[];
  issueCount: number;
  warningCount: number;
  channelReady: boolean;
  channelMessages: string[];
};

export function assessSku(input: {
  values: FieldBag;
  definitions: AttributeDefinition[];
  picklists: Picklist[];
  taxSchedule: TaxSchedule;
  relationshipRules: RelationshipRule[];
  channel: ChannelSpec;
  mediaStatus: "ok" | "pending" | "failed" | "missing";
}): QualityCache {
  const catalogIssues = validateFlatRecord(input);
  const completeness = scoreCompleteness(input.values, input.definitions, input.relationshipRules);
  const channelIssues = channelReadiness({
    values: input.values,
    channel: input.channel,
    mediaStatus: input.mediaStatus,
  });
  const issueCount = catalogIssues.filter((item) => item.severity === "error").length
    + channelIssues.filter((item) => item.severity === "error").length;
  const warningCount = [...catalogIssues, ...channelIssues].filter((item) => item.severity === "warning").length;
  const channelReady = input.mediaStatus === "ok"
    && catalogIssues.every((item) => item.severity !== "error")
    && channelIssues.every((item) => item.severity !== "error");
  const channelMessages = [...catalogIssues, ...channelIssues]
    .filter((item) => item.severity !== "info")
    .map((item) => item.message);
  return {
    completenessPct: completeness.pct,
    missing: completeness.missing,
    issueCount,
    warningCount,
    channelReady,
    channelMessages,
  };
}
