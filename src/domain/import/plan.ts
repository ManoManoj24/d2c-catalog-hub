import type {
  AttributeDefinition,
  CommitRow,
  FieldBag,
  ImportAction,
  Issue,
  Picklist,
  PlanSummary,
  RelationshipRule,
  TaxSchedule,
} from "../types";
import { fingerprint } from "../diff";
import { isBlank, slugCode, splitByScope } from "../quality/fields";
import { applyCoercion, validateFlatRecord } from "../quality/validate";

export function commitFingerprint(row: Pick<CommitRow, "styleName" | "variationTheme" | "styleValues" | "colorName" | "colorValues" | "size" | "barcode" | "mrp" | "skuValues" | "media">): string {
  return fingerprint({
    styleName: row.styleName,
    variationTheme: row.variationTheme,
    styleValues: row.styleValues,
    colorName: row.colorName,
    colorValues: row.colorValues,
    size: row.size,
    barcode: row.barcode,
    mrp: row.mrp,
    skuValues: row.skuValues,
    media: [...row.media].sort((left, right) => left.role.localeCompare(right.role) || left.url.localeCompare(right.url)),
  });
}

export type MappedRow = { rowNumber: number; raw: Record<string, string> };

export function rowsFromMapping(
  rows: MappedRow[],
  mapping: Record<string, string | null>,
  definitions: AttributeDefinition[],
): Array<{ rowNumber: number; raw: Record<string, string>; values: FieldBag; formulaCells: string[] }> {
  return rows.map((row) => {
    const flat: FieldBag = {};
    const formulaCells: string[] = [];
    for (const [column, attributeKey] of Object.entries(mapping)) {
      if (!attributeKey) continue;
      const raw = row.raw[column] ?? "";
      if (typeof raw === "string" && /^[=+\-@]/.test(raw.trim())) formulaCells.push(column);
      flat[attributeKey] = raw;
    }
    return { rowNumber: row.rowNumber, raw: row.raw, values: applyCoercion(flat, definitions), formulaCells };
  });
}

export function planImport(input: {
  rows: Array<{ rowNumber: number; raw: Record<string, string>; values: FieldBag; formulaCells?: string[] }>;
  definitions: AttributeDefinition[];
  picklists: Picklist[];
  taxSchedule: TaxSchedule;
  relationshipRules: RelationshipRule[];
  existingFingerprints: Record<string, string>;
  mode: "atomic" | "partial";
}): { rows: CommitRow[]; issues: Issue[]; summary: PlanSummary } {
  const skuSeen = new Map<string, number>();
  const styleNames = new Map<string, { name: string; rowNumber: number }>();
  const commitRows: CommitRow[] = [];
  const issues: Issue[] = [];

  for (const row of input.rows) {
    const values = row.values;
    const rowIssues = validateFlatRecord({
      values,
      definitions: input.definitions,
      picklists: input.picklists,
      taxSchedule: input.taxSchedule,
      relationshipRules: input.relationshipRules,
      rowNumber: row.rowNumber,
    });
    for (const column of row.formulaCells ?? []) {
      rowIssues.push({
        severity: "warning",
        rowNumber: row.rowNumber,
        rule: "formula_neutralized",
        message: `Column ${column} starts with a formula-like character and will be stored as text.`,
        proposedFix: "Confirm the source cell is a value, not a spreadsheet formula.",
      });
    }

    const parts = splitByScope(values, input.definitions);
    const styleCode = String(values.style_code ?? "").trim();
    const sku = String(values.sku ?? "").trim();
    const styleName = String(values.style_name ?? "").trim();
    const theme = String(values.variation_theme ?? "").trim();
    const colorName = String(values.color ?? "").trim();
    const colorCode = String(values.color_code ?? "").trim() || (colorName ? slugCode(colorName) : "DEFAULT");
    const size = String(values.size ?? "").trim();
    const barcode = isBlank(values.barcode) ? null : String(values.barcode);
    const mrp = typeof values.mrp === "number" ? values.mrp : null;

    if (styleCode && styleName) {
      const prior = styleNames.get(styleCode);
      if (prior && prior.name !== styleName) {
        rowIssues.push({
          severity: "error",
          rowNumber: row.rowNumber,
          attributeKey: "style_name",
          rule: "style_conflict",
          message: `Style ${styleCode} is named “${prior.name}” on row ${prior.rowNumber} and “${styleName}” on row ${row.rowNumber}.`,
          proposedFix: "Use one style name per style code in the file.",
        });
      } else if (!prior) {
        styleNames.set(styleCode, { name: styleName, rowNumber: row.rowNumber });
      }
    }

    if (sku) {
      const priorRow = skuSeen.get(sku);
      if (priorRow) {
        rowIssues.push({
          severity: "error",
          rowNumber: row.rowNumber,
          attributeKey: "sku",
          rule: "duplicate_sku",
          message: `SKU ${sku} is also on row ${priorRow}.`,
          proposedFix: "Keep one row per SKU.",
        });
      } else {
        skuSeen.set(sku, row.rowNumber);
      }
    }

    const media: CommitRow["media"] = [];
    if (typeof values.main_image_url === "string" && values.main_image_url) {
      media.push({ role: "main", url: values.main_image_url });
    }
    if (typeof values.alt_image_url === "string" && values.alt_image_url) {
      media.push({ role: "alternate", url: values.alt_image_url });
    }

    const draft: CommitRow = {
      action: "create",
      rowNumber: row.rowNumber,
      styleCode,
      styleName,
      variationTheme: theme,
      styleValues: parts.style,
      colorCode,
      colorName,
      colorValues: parts.colorway,
      media,
      sku,
      size,
      barcode,
      mrp,
      skuValues: parts.sku,
      issues: rowIssues,
    };

    const errors = rowIssues.filter((item) => item.severity === "error");
    let action: ImportAction = "create";
    if (errors.some((item) => item.rule === "duplicate_sku" || item.rule === "style_conflict")) action = "conflict";
    else if (errors.length > 0) action = "skip";
    else if (sku && input.existingFingerprints[sku]) {
      action = input.existingFingerprints[sku] === commitFingerprint(draft) ? "unchanged" : "update";
    }
    draft.action = action;
    issues.push(...rowIssues);
    commitRows.push(draft);
  }

  const conflictSkus = new Set(commitRows.filter((row) => row.issues.some((item) => item.rule === "duplicate_sku")).map((row) => row.sku));
  const conflictStyles = new Set(commitRows.filter((row) => row.issues.some((item) => item.rule === "style_conflict")).map((row) => row.styleCode));
  for (const row of commitRows) {
    if ((row.sku && conflictSkus.has(row.sku)) || (row.styleCode && conflictStyles.has(row.styleCode))) {
      row.action = "conflict";
    }
  }

  const errorCount = issues.filter((item) => item.severity === "error").length;
  const warningCount = issues.filter((item) => item.severity === "warning").length;
  const blocked = input.mode === "atomic" && errorCount > 0;

  const styleKeys = new Set(commitRows.filter((row) => row.styleCode).map((row) => row.styleCode));
  const colorKeys = new Set(commitRows.filter((row) => row.styleCode).map((row) => `${row.styleCode}::${row.colorCode}`));
  const summary: PlanSummary = {
    creates: commitRows.filter((row) => row.action === "create").length,
    updates: commitRows.filter((row) => row.action === "update").length,
    unchanged: commitRows.filter((row) => row.action === "unchanged").length,
    skipped: commitRows.filter((row) => row.action === "skip").length,
    conflicts: commitRows.filter((row) => row.action === "conflict").length,
    errorCount,
    warningCount,
    styles: styleKeys.size,
    colorways: colorKeys.size,
    skus: commitRows.length,
    blocked,
  };
  return { rows: commitRows, issues, summary };
}
