import type { AttributeDefinition, FieldBag, RelationshipRule } from "../types";

export function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

export function normalizeMonth(raw: string): string | null {
  const value = raw.trim();
  const iso = value.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const local = value.match(/^(0[1-9]|1[0-2])-(\d{4})$/);
  if (local) return `${local[2]}-${local[1]}`;
  return null;
}

export function coerceAttribute(def: AttributeDefinition, raw: unknown): unknown {
  if (isBlank(raw)) return null;
  const text = String(raw).trim();
  if (def.dataType === "number" || def.dataType === "measurement") {
    const numeric = Number(text.replace(/,/g, "").replace(/₹/g, ""));
    return Number.isFinite(numeric) ? numeric : text;
  }
  if (def.dataType === "month_year") return normalizeMonth(text) ?? text;
  return text;
}

export function extraRequiredKeys(values: FieldBag, rules: RelationshipRule[]): Set<string> {
  const keys = new Set<string>();
  for (const rule of rules) {
    if (String(values[rule.when.attribute] ?? "") === rule.when.equals) {
      for (const key of rule.require) keys.add(key);
    }
  }
  return keys;
}

export function splitByScope(flat: FieldBag, definitions: AttributeDefinition[]) {
  const style: FieldBag = {};
  const colorway: FieldBag = {};
  const sku: FieldBag = {};
  for (const def of definitions) {
    if (isBlank(flat[def.key])) continue;
    const target = def.scope === "style" ? style : def.scope === "colorway" ? colorway : sku;
    target[def.key] = flat[def.key];
  }
  return { style, colorway, sku };
}

export function slugCode(value: string): string {
  const slug = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug.slice(0, 20) || "DEFAULT";
}
