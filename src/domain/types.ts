export const ROLES = ["owner", "admin", "editor", "reviewer", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const SCOPES = ["style", "colorway", "sku"] as const;
export type Scope = (typeof SCOPES)[number];

export const DATA_TYPES = ["text", "number", "picklist", "month_year", "url", "measurement"] as const;
export type DataType = (typeof DATA_TYPES)[number];

export const PRODUCT_STATUSES = ["draft", "approved", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const ISSUE_SEVERITIES = ["error", "warning", "info"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export type AttributeRules = {
  pattern?: string;
  min?: number;
  max?: number;
  picklistKey?: string;
  maxLength?: number;
};

export type AttributeDefinition = {
  key: string;
  label: string;
  dataType: DataType;
  scope: Scope;
  groupKey: string;
  groupLabel: string;
  sortOrder: number;
  required: boolean;
  help?: string;
  rules: AttributeRules;
  packOrigin: string | null;
};

export type PicklistValue = { value: string; label: string };
export type Picklist = { key: string; values: PicklistValue[] };

export type TaxRateRule = {
  maxSaleValueInrInclusive: number | null;
  ratePercent: number;
  note?: string;
};

export type TaxHsnEntry = {
  code: string;
  label: string;
  ageBand: string;
  construction: string;
  rateRules: TaxRateRule[];
};

export type TaxSchedule = {
  id: string;
  activation: "active" | "retained";
  effectiveFrom: string | null;
  reviewStatus: string;
  priceBasis: string;
  disclaimer: string;
  sources: { title: string; url: string }[];
  hsn: TaxHsnEntry[];
};

export type RelationshipRule = {
  id: string;
  when: { attribute: string; equals: string };
  require: string[];
};

export type ChannelColumn = {
  header: string;
  attribute: string;
  scope: Scope | "derived";
  required: boolean;
  derived?: "row_type" | "parent_style";
};

export type ChannelSpec = {
  key: string;
  name: string;
  format: "csv" | "xlsx";
  templateFile: string;
  dataSheet: string;
  headerRow: number;
  insertionRow: number;
  columns: ChannelColumn[];
};

export type PackDefinition = {
  key: string;
  version: number;
  name: string;
  variationThemeDefault: "SizeColor" | "Size" | "Color";
  description?: string;
  attributes: Array<Omit<AttributeDefinition, "packOrigin"> & { packOrigin?: string | null }>;
  picklists: Picklist[];
  relationshipRules: RelationshipRule[];
  taxSchedules: TaxSchedule[];
  channels: ChannelSpec[];
  media: {
    scopes: string[];
    inheritance: string;
    allowedContentTypes: string[];
  };
  limits: {
    storageCapBytes: number;
    maxUploadBytes: number;
    maxImportBytes: number;
    maxImportRows: number;
    maxCellLength: number;
    allowedImageTypes: string[];
    allowedImportTypes: string[];
  };
};

export type TenantOverride = {
  key: string;
  label?: string;
  required?: boolean;
  enabled?: boolean;
};

export type Issue = {
  severity: IssueSeverity;
  rowNumber?: number;
  attributeKey?: string;
  rule: string;
  message: string;
  proposedFix?: string;
};

export type FieldBag = Record<string, unknown>;

export type ImportAction = "create" | "update" | "unchanged" | "skip" | "conflict";

export type CommitRow = {
  action: ImportAction;
  rowNumber: number;
  styleCode: string;
  styleName: string;
  variationTheme: string;
  styleValues: FieldBag;
  colorCode: string;
  colorName: string;
  colorValues: FieldBag;
  media: { role: "main" | "alternate"; url: string }[];
  sku: string;
  size: string;
  barcode: string | null;
  mrp: number | null;
  skuValues: FieldBag;
  issues: Issue[];
};

export type PlanSummary = {
  creates: number;
  updates: number;
  unchanged: number;
  skipped: number;
  conflicts: number;
  errorCount: number;
  warningCount: number;
  styles: number;
  colorways: number;
  skus: number;
  blocked: boolean;
};

export const JOB_BATCH_DEFAULT = 250;
