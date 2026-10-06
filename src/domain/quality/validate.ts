import type { AttributeDefinition, FieldBag, Issue, Picklist, RelationshipRule, TaxSchedule } from "../types";
import { coerceAttribute, extraRequiredKeys, isBlank } from "./fields";
import { resolveGstRate } from "./tax";

function issue(partial: Issue): Issue {
  return partial;
}

export function validateFlatRecord(input: {
  values: FieldBag;
  definitions: AttributeDefinition[];
  picklists: Picklist[];
  taxSchedule: TaxSchedule;
  relationshipRules: RelationshipRule[];
  rowNumber?: number;
}): Issue[] {
  const issues: Issue[] = [];
  const picklists = new Map(input.picklists.map((item) => [item.key, item]));
  const forced = extraRequiredKeys(input.values, input.relationshipRules);

  for (const def of input.definitions) {
    const value = input.values[def.key];
    const required = def.required || forced.has(def.key);
    if (isBlank(value)) {
      if (required) {
        issues.push(issue({
          severity: "error",
          rowNumber: input.rowNumber,
          attributeKey: def.key,
          rule: "required",
          message: `${def.label} is required.`,
          proposedFix: def.help ?? `Provide ${def.label}.`,
        }));
      }
      continue;
    }

    if ((def.dataType === "number" || def.dataType === "measurement") && typeof value !== "number") {
      issues.push(issue({
        severity: "error",
        rowNumber: input.rowNumber,
        attributeKey: def.key,
        rule: "type",
        message: `${def.label} must be a number.`,
        proposedFix: "Remove currency symbols and use digits only.",
      }));
      continue;
    }

    if (typeof value === "number") {
      if (def.rules.min != null && value < def.rules.min) {
        issues.push(issue({
          severity: "error",
          rowNumber: input.rowNumber,
          attributeKey: def.key,
          rule: "min",
          message: `${def.label} must be at least ${def.rules.min}.`,
        }));
      }
      if (def.rules.max != null && value > def.rules.max) {
        issues.push(issue({
          severity: "error",
          rowNumber: input.rowNumber,
          attributeKey: def.key,
          rule: "max",
          message: `${def.label} must be at most ${def.rules.max}.`,
        }));
      }
    }

    if (typeof value === "string") {
      if (def.rules.maxLength != null && value.length > def.rules.maxLength) {
        issues.push(issue({
          severity: "error",
          rowNumber: input.rowNumber,
          attributeKey: def.key,
          rule: "max_length",
          message: `${def.label} is longer than ${def.rules.maxLength} characters.`,
        }));
      }
      if (def.rules.pattern && !new RegExp(def.rules.pattern, def.key === "net_quantity" ? "i" : undefined).test(value)) {
        issues.push(issue({
          severity: "error",
          rowNumber: input.rowNumber,
          attributeKey: def.key,
          rule: "pattern",
          message: `${def.label} does not match the required format.`,
          proposedFix: def.help,
        }));
      }
      if (def.dataType === "url") {
        try {
          const url = new URL(value);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            throw new Error("protocol");
          }
        } catch {
          issues.push(issue({
            severity: "error",
            rowNumber: input.rowNumber,
            attributeKey: def.key,
            rule: "url",
            message: `${def.label} must be an http(s) URL.`,
          }));
        }
      }
    }

    if (def.rules.picklistKey) {
      const list = picklists.get(def.rules.picklistKey);
      const allowed = list?.values.map((item) => item.value) ?? [];
      if (!allowed.includes(String(value))) {
        issues.push(issue({
          severity: "error",
          rowNumber: input.rowNumber,
          attributeKey: def.key,
          rule: "picklist",
          message: `${def.label} “${String(value)}” is not an allowed value.`,
          proposedFix: allowed.length ? `Use one of: ${allowed.slice(0, 8).join(", ")}.` : "Install the picklist for this field.",
        }));
      }
    }
  }

  const hsn = input.values.hsn_code;
  const mrp = input.values.mrp;
  const gst = input.values.gst_rate;
  if (typeof hsn === "string" && hsn && typeof mrp === "number") {
    const resolved = resolveGstRate(input.taxSchedule, hsn, mrp);
    if (!resolved.ok) {
      issues.push(issue({
        severity: "error",
        rowNumber: input.rowNumber,
        attributeKey: "hsn_code",
        rule: "tax_schedule",
        message: resolved.message,
        proposedFix: resolved.proposedFix,
      }));
    } else if (typeof gst === "number" && gst !== resolved.ratePercent) {
      issues.push(issue({
        severity: "error",
        rowNumber: input.rowNumber,
        attributeKey: "gst_rate",
        rule: "tax_schedule",
        message: `GST ${gst}% does not match schedule ${resolved.scheduleId}, which expects ${resolved.ratePercent}% for HSN ${hsn} at MRP ${mrp} (${input.taxSchedule.priceBasis}).`,
        proposedFix: `Set GST rate to ${resolved.ratePercent}. Confirm the schedule before filing.`,
      }));
    } else if (typeof gst !== "number") {
      issues.push(issue({
        severity: "error",
        rowNumber: input.rowNumber,
        attributeKey: "gst_rate",
        rule: "tax_schedule",
        message: `GST rate is missing. Schedule ${resolved.scheduleId} expects ${resolved.ratePercent}% for this HSN and MRP.`,
        proposedFix: `Enter ${resolved.ratePercent} after you confirm the tax schedule.`,
      }));
    } else if (input.taxSchedule.reviewStatus !== "verified") {
      issues.push(issue({
        severity: "warning",
        rowNumber: input.rowNumber,
        attributeKey: "gst_rate",
        rule: "tax_schedule_review",
        message: `GST matches candidate schedule ${resolved.scheduleId}, which is not a verified filing table.`,
        proposedFix: "Confirm HSN, rate, price basis, and effective date with a tax adviser or CBIC notification.",
      }));
    }
  }

  return issues;
}

export function applyCoercion(flat: FieldBag, definitions: AttributeDefinition[]): FieldBag {
  const next: FieldBag = {};
  const defs = new Map(definitions.map((def) => [def.key, def]));
  for (const [key, value] of Object.entries(flat)) {
    const def = defs.get(key);
    next[key] = def ? coerceAttribute(def, value) : value;
  }
  return next;
}
