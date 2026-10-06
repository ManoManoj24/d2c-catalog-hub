import type { AttributeDefinition } from "../types";

const ALIASES: Record<string, string> = {
  product_name: "style_name",
  title: "style_name",
  name: "style_name",
  style: "style_code",
  colour: "color",
  color_name: "color",
  colour_code: "color_code",
  selling_price: "mrp",
  price: "mrp",
  image: "main_image_url",
  image_url: "main_image_url",
  main_image: "main_image_url",
  alt_image: "alt_image_url",
  hsn: "hsn_code",
  gst: "gst_rate",
  gst_percent: "gst_rate",
  gst_slab: "gst_rate",
  origin: "country_of_origin",
  country: "country_of_origin",
  month_year: "mfg_pack_month_year",
  mfg_date: "mfg_pack_month_year",
  packing_month: "mfg_pack_month_year",
  qty: "net_quantity",
  net_qty: "net_quantity",
  age: "age_range",
  age_group: "age_range",
  unit: "size_unit",
};

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export type MappingSuggestion = {
  column: string;
  attributeKey: string | null;
  confidence: "exact" | "alias" | "label" | "none";
};

export function suggestMapping(headers: string[], definitions: AttributeDefinition[]): MappingSuggestion[] {
  const byKey = new Map(definitions.map((def) => [def.key, def]));
  const byLabel = new Map(definitions.map((def) => [normalizeHeader(def.label), def.key]));
  const used = new Set<string>();
  return headers.map((column) => {
    const norm = normalizeHeader(column);
    const alias = ALIASES[norm];
    let key: string | null = null;
    let confidence: MappingSuggestion["confidence"] = "none";
    if (byKey.has(norm)) {
      key = norm;
      confidence = "exact";
    } else if (alias && byKey.has(alias)) {
      key = alias;
      confidence = "alias";
    } else if (byLabel.has(norm)) {
      key = byLabel.get(norm) ?? null;
      confidence = "label";
    }
    if (key && used.has(key)) {
      return { column, attributeKey: null, confidence: "none" as const };
    }
    if (key) used.add(key);
    return { column, attributeKey: key, confidence };
  });
}

export function duplicateHeaders(headers: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const header of headers) {
    const key = normalizeHeader(header);
    if (seen.has(key)) dupes.add(header);
    seen.add(key);
  }
  return [...dupes];
}
