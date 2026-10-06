import type { AttributeDefinition, TenantOverride } from "../types";

export type MergeConflict = {
  key: string;
  kind: "type_change_blocked" | "loosen_required_blocked" | "disable_required_blocked" | "pack_change_needs_acceptance" | "removal_blocked";
  message: string;
};

export type MergeResult = {
  definitions: AttributeDefinition[];
  added: string[];
  updated: string[];
  preservedOverrides: string[];
  conflicts: MergeConflict[];
};

function sameShape(a: AttributeDefinition, b: AttributeDefinition): boolean {
  return a.dataType === b.dataType && a.scope === b.scope;
}

function withOverride(def: AttributeDefinition, override: TenantOverride | undefined, conflicts: MergeConflict[]): AttributeDefinition {
  if (!override) return def;
  let required = def.required;
  if (override.required === true) required = true;
  if (override.required === false && def.required) {
    conflicts.push({
      key: def.key,
      kind: "loosen_required_blocked",
      message: `${def.label} is required by the pack. A tenant can tighten validation, not loosen it.`,
    });
  } else if (override.required === false) {
    required = false;
  }
  if (override.enabled === false && def.required) {
    conflicts.push({
      key: def.key,
      kind: "disable_required_blocked",
      message: `${def.label} is required by the pack and cannot be disabled.`,
    });
  }
  const label = override.label?.trim() ? override.label.trim() : def.label;
  return { ...def, label, required };
}

export function mergePackDefinitions(input: {
  packAttributes: AttributeDefinition[];
  installed: AttributeDefinition[];
  overrides: TenantOverride[];
  valueCounts: Record<string, number>;
  acceptPackChanges: boolean;
}): MergeResult {
  const overrides = new Map(input.overrides.map((item) => [item.key, item]));
  const installed = new Map(input.installed.map((item) => [item.key, item]));
  const conflicts: MergeConflict[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  const preservedOverrides: string[] = [];
  const next: AttributeDefinition[] = [];
  const seen = new Set<string>();

  for (const packDef of input.packAttributes) {
    seen.add(packDef.key);
    const override = overrides.get(packDef.key);
    const current = installed.get(packDef.key);
    if (!current) {
      next.push(withOverride(packDef, override, conflicts));
      added.push(packDef.key);
      if (override?.label) preservedOverrides.push(packDef.key);
      continue;
    }

    if (!sameShape(current, packDef)) {
      const values = input.valueCounts[packDef.key] ?? 0;
      if (values > 0) {
        conflicts.push({
          key: packDef.key,
          kind: "type_change_blocked",
          message: `${current.label} cannot change from ${current.dataType}/${current.scope} to ${packDef.dataType}/${packDef.scope} while ${values} value(s) exist.`,
        });
        next.push(withOverride(current, override, conflicts));
        if (override?.label) preservedOverrides.push(packDef.key);
        continue;
      }
      if (!input.acceptPackChanges) {
        conflicts.push({
          key: packDef.key,
          kind: "pack_change_needs_acceptance",
          message: `${current.label} would change type or scope. Accept the pack change explicitly before it is applied.`,
        });
        next.push(withOverride(current, override, conflicts));
        if (override?.label) preservedOverrides.push(packDef.key);
        continue;
      }
    }

    const mergedBase: AttributeDefinition = {
      ...packDef,
      label: packDef.label,
      required: packDef.required,
    };
    const merged = withOverride(mergedBase, override, conflicts);
    if (override?.label && override.label !== packDef.label) preservedOverrides.push(packDef.key);
    if (JSON.stringify(merged) !== JSON.stringify(current)) updated.push(packDef.key);
    next.push(merged);
  }

  for (const current of input.installed) {
    if (seen.has(current.key)) continue;
    if (current.packOrigin) {
      const values = input.valueCounts[current.key] ?? 0;
      if (values > 0 || !input.acceptPackChanges) {
        conflicts.push({
          key: current.key,
          kind: "removal_blocked",
          message: values > 0
            ? `${current.label} was removed from the pack but still has values.`
            : `${current.label} was removed from the pack. Accept the pack change to drop it.`,
        });
        next.push(current);
        continue;
      }
      updated.push(current.key);
      continue;
    }
    next.push(current);
  }

  next.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return { definitions: next, added, updated, preservedOverrides, conflicts };
}
