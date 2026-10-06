import type { ChannelSpec, FieldBag } from "../types";
import { neutralizeCell } from "./neutralize";

export type ExportSku = {
  sku: string;
  values: FieldBag;
  channelReady: boolean;
  channelMessages: string[];
};

export type ExportPreview = {
  headers: string[];
  parentRows: number;
  childRows: number;
  blocked: { sku: string; messages: string[] }[];
  matrix: string[][];
};

function cell(values: FieldBag, column: ChannelSpec["columns"][number], kind: "parent" | "child", styleCode: string): string {
  if (column.derived === "row_type") return kind === "parent" ? "Parent" : "Child";
  if (column.derived === "parent_style") return kind === "child" ? styleCode : "";
  if (kind === "parent" && (column.scope === "sku" || column.attribute === "color" || column.attribute === "size")) {
    return "";
  }
  return neutralizeCell(values[column.attribute]);
}

export function buildChannelMatrix(channel: ChannelSpec, skus: ExportSku[]): ExportPreview {
  const headers = channel.columns.map((column) => column.header);
  const ready = skus.filter((sku) => sku.channelReady);
  const blocked = skus.filter((sku) => !sku.channelReady).map((sku) => ({ sku: sku.sku, messages: sku.channelMessages }));
  const byStyle = new Map<string, ExportSku[]>();
  for (const sku of ready) {
    const styleCode = String(sku.values.style_code ?? "");
    const list = byStyle.get(styleCode) ?? [];
    list.push(sku);
    byStyle.set(styleCode, list);
  }
  const matrix: string[][] = [];
  for (const [styleCode, group] of byStyle) {
    const sample = group[0].values;
    matrix.push(channel.columns.map((column) => cell(sample, column, "parent", styleCode)));
    for (const sku of group) {
      matrix.push(channel.columns.map((column) => cell(sku.values, column, "child", styleCode)));
    }
  }
  return {
    headers,
    parentRows: byStyle.size,
    childRows: ready.length,
    blocked,
    matrix,
  };
}
