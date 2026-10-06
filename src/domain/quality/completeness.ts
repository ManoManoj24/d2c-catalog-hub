import type { AttributeDefinition, ChannelSpec, FieldBag, Issue, RelationshipRule } from "../types";
import { extraRequiredKeys, isBlank } from "./fields";

export type Completeness = {
  pct: number;
  filled: number;
  total: number;
  missing: string[];
};

export function scoreCompleteness(
  values: FieldBag,
  definitions: AttributeDefinition[],
  rules: RelationshipRule[],
): Completeness {
  const forced = extraRequiredKeys(values, rules);
  const required = definitions.filter((def) => def.required || forced.has(def.key));
  const missing = required.filter((def) => isBlank(values[def.key])).map((def) => def.key);
  const total = required.length;
  const filled = total - missing.length;
  const pct = total === 0 ? 100 : Math.round((filled / total) * 100);
  return { pct, filled, total, missing };
}

export function channelReadiness(input: {
  values: FieldBag;
  channel: ChannelSpec;
  mediaStatus: "ok" | "pending" | "failed" | "missing";
  rowNumber?: number;
}): Issue[] {
  const issues: Issue[] = [];
  for (const column of input.channel.columns) {
    if (!column.required || column.scope === "derived") continue;
    if (isBlank(input.values[column.attribute])) {
      issues.push({
        severity: "error",
        rowNumber: input.rowNumber,
        attributeKey: column.attribute,
        rule: "channel_required",
        message: `${input.channel.name} requires ${column.header}.`,
        proposedFix: `Fill ${column.header} before export.`,
      });
    }
  }
  if (input.mediaStatus === "missing" || input.mediaStatus === "failed") {
    issues.push({
      severity: "error",
      rowNumber: input.rowNumber,
      attributeKey: "main_image_url",
      rule: "media_reference",
      message: input.mediaStatus === "missing"
        ? "Main image has not been recorded for this colorway."
        : "Main image URL failed the reachability check.",
      proposedFix: "Use an http(s) image URL that returns 200 with a JPEG, PNG, or WebP content type, or upload a file under the storage cap.",
    });
  } else if (input.mediaStatus === "pending") {
    issues.push({
      severity: "warning",
      rowNumber: input.rowNumber,
      attributeKey: "main_image_url",
      rule: "media_pending",
      message: "Main image URL is still being checked.",
      proposedFix: "Wait for the media check before treating the SKU as channel-ready.",
    });
  }
  return issues;
}

export function mediaStatusRank(statuses: Array<"ok" | "pending" | "failed" | "missing">): "ok" | "pending" | "failed" | "missing" {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("missing") || statuses.length === 0) return "missing";
  if (statuses.includes("pending")) return "pending";
  return "ok";
}
