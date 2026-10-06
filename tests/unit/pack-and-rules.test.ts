import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { can } from "@/domain/authz";
import { definitionsFromPack, loadKidswearPack } from "@/domain/pack/load";
import { mergePackDefinitions } from "@/domain/pack/merge";
import { planImport } from "@/domain/import/plan";
import { suggestMapping } from "@/domain/import/mapping";
import { activeTaxSchedule, resolveGstRate } from "@/domain/quality/tax";
import { applyCoercion, validateFlatRecord } from "@/domain/quality/validate";
import { scoreCompleteness } from "@/domain/quality/completeness";
import type { AttributeDefinition, TaxSchedule } from "@/domain/types";
import { hsnPicklist } from "@/domain/pack/load";

const loaded = loadKidswearPack();
const defs = definitionsFromPack(loaded.pack);
const active = activeTaxSchedule(loaded.pack.taxSchedules);
const picklists = [...loaded.pack.picklists, hsnPicklist(active)];

function blankRow(): Record<string, unknown> {
  return Object.fromEntries(defs.map((def) => [def.key, null]));
}

describe("kidswear pack merge", () => {
  it("installs every group onto an empty catalog", () => {
    const merged = mergePackDefinitions({
      packAttributes: defs,
      installed: [],
      overrides: [],
      valueCounts: {},
      acceptPackChanges: true,
    });
    expect(merged.conflicts).toEqual([]);
    expect(merged.added).toContain("hsn_code");
    expect(new Set(merged.definitions.map((def) => def.groupKey))).toEqual(
      new Set(["identity", "variation", "legal_metrology", "business_identity", "taxation", "consumer_sizing", "media"]),
    );
  });

  it("keeps a tenant label and refuses to loosen a required field", () => {
    const installed = defs.map((def) => ({ ...def }));
    const merged = mergePackDefinitions({
      packAttributes: defs.map((def) => (def.key === "brand" ? { ...def, label: "Brand name" } : def)),
      installed,
      overrides: [{ key: "brand", label: "House brand", required: false }],
      valueCounts: {},
      acceptPackChanges: true,
    });
    expect(merged.definitions.find((def) => def.key === "brand")?.label).toBe("House brand");
    expect(merged.conflicts.some((conflict) => conflict.kind === "loosen_required_blocked")).toBe(true);
  });

  it("blocks a type change when values exist and accepts a second pack as data", () => {
    const blocked = mergePackDefinitions({
      packAttributes: defs.map((def) => (def.key === "age_range" ? { ...def, dataType: "text" } : def)),
      installed: defs,
      overrides: [],
      valueCounts: { age_range: 4 },
      acceptPackChanges: true,
    });
    expect(blocked.conflicts.some((conflict) => conflict.kind === "type_change_blocked")).toBe(true);
    expect(blocked.definitions.find((def) => def.key === "age_range")?.dataType).toBe("picklist");

    const homeware: AttributeDefinition[] = [{
      key: "material",
      label: "Material",
      dataType: "text",
      scope: "style",
      groupKey: "identity",
      groupLabel: "Identity",
      sortOrder: 1,
      required: true,
      rules: {},
      packOrigin: "homeware@1",
    }];
    const second = mergePackDefinitions({
      packAttributes: homeware,
      installed: [],
      overrides: [],
      valueCounts: {},
      acceptPackChanges: true,
    });
    expect(second.added).toEqual(["material"]);
  });
});

describe("tax schedule is data", () => {
  it("does not embed rates in the resolver", () => {
    const source = fs.readFileSync("src/domain/quality/tax.ts", "utf8");
    expect(source).not.toMatch(/\b(1000|2500|12|18)\b/);
  });

  it("follows whichever schedule it is given", () => {
    const draft = loaded.pack.taxSchedules.find((schedule) => schedule.id.includes("architecture-draft"));
    expect(draft).toBeTruthy();
    const high = resolveGstRate(active, "6104", 1299);
    const lowDraft = resolveGstRate(draft as TaxSchedule, "6104", 1299);
    const baby = resolveGstRate(active, "6111", 4000);
    expect(high.ok && high.ratePercent).toBe(5);
    expect(lowDraft.ok && lowDraft.ratePercent).toBe(12);
    expect(baby.ok && baby.ratePercent).toBe(5);
    expect(active.reviewStatus).toBe("candidate");
  });
});

describe("validation", () => {
  const base = {
    ...blankRow(),
    style_code: "KW-1",
    style_name: "Romper",
    brand: "Tiny Nest",
    variation_theme: "SizeColor",
    color: "Sky Blue",
    color_code: "SKY",
    size: "0-3M",
    sku: "KW-1-SKY-03",
    mfg_pack_month_year: "03-2026",
    net_quantity: "1 N",
    country_of_origin: "India",
    manufacturer_name: "Tiny Nest Apparel Pvt Ltd",
    manufacturer_address: "Tiruppur",
    packer_name: "Tiny Nest Apparel Pvt Ltd",
    packer_address: "Tiruppur",
    hsn_code: "6111",
    gst_rate: 5,
    age_range: "0-3M",
    size_unit: "cm",
    chest: 40,
    length: 48,
    mrp: 799,
    fabric: "Cotton",
    main_image_url: "https://cdn.example/romper.png",
  };

  it("normalizes month-year and explains a bad net quantity", () => {
    const issues = validateFlatRecord({
      values: { ...base, net_quantity: "one piece" },
      definitions: defs,
      picklists,
      taxSchedule: active,
      relationshipRules: loaded.pack.relationshipRules,
      rowNumber: 4,
    });
    expect(issues.some((issue) => issue.attributeKey === "net_quantity" && issue.rowNumber === 4)).toBe(true);
    const coerced = applyCoercion(base, defs);
    expect(coerced.mfg_pack_month_year).toBe("2026-03");
    const ok = validateFlatRecord({
      values: coerced,
      definitions: defs,
      picklists,
      taxSchedule: active,
      relationshipRules: loaded.pack.relationshipRules,
    });
    expect(ok.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(scoreCompleteness(base, defs, loaded.pack.relationshipRules).missing).toEqual([]);
  });

  it("requires color and size only for the SizeColor theme", () => {
    const issues = validateFlatRecord({
      values: { ...base, color: null, color_code: null, size: null },
      definitions: defs,
      picklists,
      taxSchedule: active,
      relationshipRules: loaded.pack.relationshipRules,
    });
    expect(issues.map((issue) => issue.attributeKey)).toEqual(expect.arrayContaining(["color", "color_code", "size"]));
  });
});

describe("import planning", () => {
  it("suggests headers and collapses two sizes into one colorway", () => {
    const headers = ["sku", "style_code", "colour", "MRP"];
    const suggestions = suggestMapping(headers, defs);
    expect(suggestions.find((item) => item.column === "colour")?.attributeKey).toBe("color");
    expect(suggestions.find((item) => item.column === "MRP")?.attributeKey).toBe("mrp");
    const row = {
      style_code: "KW-1",
      style_name: "Romper",
      brand: "Tiny Nest",
      variation_theme: "SizeColor",
      color: "Sky Blue",
      color_code: "SKY",
      mfg_pack_month_year: "2026-03",
      net_quantity: "1 N",
      country_of_origin: "India",
      manufacturer_name: "Maker",
      manufacturer_address: "Addr",
      packer_name: "Packer",
      packer_address: "Addr",
      hsn_code: "6111",
      gst_rate: 5,
      age_range: "0-3M",
      size_unit: "cm",
      fabric: "Cotton",
      main_image_url: "https://cdn.example/a.png",
    };
    const plan = planImport({
      rows: [
        { rowNumber: 2, raw: {}, values: { ...row, sku: "KW-1-A", size: "0-3M", chest: 40, length: 48, mrp: 799 } },
        { rowNumber: 3, raw: {}, values: { ...row, sku: "KW-1-B", size: "3-6M", chest: 42, length: 50, mrp: 799 } },
      ],
      definitions: defs,
      picklists,
      taxSchedule: active,
      relationshipRules: loaded.pack.relationshipRules,
      existingFingerprints: {},
      mode: "atomic",
    });
    expect(plan.summary.blocked).toBe(false);
    expect(plan.summary.creates).toBe(2);
    expect(plan.summary.colorways).toBe(1);
    expect(plan.summary.styles).toBe(1);
  });
});

describe("authorization", () => {
  it("keeps viewers off edits and editors off membership changes", () => {
    expect(can("viewer", "export")).toBe(true);
    expect(can("viewer", "catalog.write")).toBe(false);
    expect(can("editor", "member.manage")).toBe(false);
    expect(can("reviewer", "approve")).toBe(true);
    expect(can("admin", "schema.write")).toBe(true);
  });
});
