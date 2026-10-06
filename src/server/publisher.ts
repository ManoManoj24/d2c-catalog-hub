import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { randomUUID } from "node:crypto";
import { buildChannelMatrix, type ExportSku } from "@/domain/publishing/rows";
import { assessSku } from "@/domain/quality/assess";
import type { FieldBag } from "@/domain/types";
import { writeAudit } from "./audit";
import { withTenant } from "./db";
import { batchSize } from "./env";
import { objectStore } from "./object-store";
import { loadSchema } from "./schema";
import { injectChannelRows } from "./template-inject";

async function loadExportSkus(tenantId: string, userId: string, catalogId: string): Promise<ExportSku[]> {
  const total = await withTenant(tenantId, userId, async (client) => {
    const result = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM variants WHERE catalog_id = $1 AND status <> 'archived'`, [catalogId]);
    return Number(result.rows[0]?.n ?? 0);
  });
  const skus: ExportSku[] = [];
  const size = batchSize();
  for (let offset = 0; offset < total; offset += size) {
    const batch = await withTenant(tenantId, userId, async (client) => {
      const schema = await loadSchema(client, catalogId);
      const variants = await client.query<{
        sku: string; size: string | null; barcode: string | null; mrp: string | null; sku_values: FieldBag; quality: { channelReady?: boolean; channelMessages?: string[] };
        style_code: string; name: string; variation_theme: string; style_values: FieldBag;
        color_code: string; color_name: string; color_values: FieldBag; color_group_id: string;
      }>(
        `SELECT v.sku, v.size, v.barcode, v.mrp::text, v.values AS sku_values, v.quality,
                p.style_code, p.name, p.variation_theme, p.values AS style_values,
                c.color_code, c.color_name, c.values AS color_values, c.id AS color_group_id
         FROM variants v
         JOIN products p ON p.id = v.product_id
         JOIN product_color_groups c ON c.id = v.color_group_id
         WHERE v.catalog_id = $1 AND v.status <> 'archived'
         ORDER BY p.style_code, c.color_code, v.sku
         LIMIT $2 OFFSET $3`,
        [catalogId, size, offset],
      );
      const ids = variants.rows.map((row) => row.color_group_id);
      const media = ids.length === 0 ? { rows: [] as { color_group_id: string; role: string; check_result: "ok" | "pending" | "failed" }[] } : await client.query<{ color_group_id: string; role: string; check_result: "ok" | "pending" | "failed" }>(
        `SELECT color_group_id, role, check_result FROM media_references WHERE color_group_id = ANY($1::uuid[]) AND scope = 'colorway'`,
        [ids],
      );
      return variants.rows.map((variant) => {
        const mains = media.rows.filter((item) => item.color_group_id === variant.color_group_id && item.role === "main");
        const mediaStatus = mains.length === 0 ? "missing" : mains.some((item) => item.check_result === "failed") ? "failed" : mains.some((item) => item.check_result === "pending") ? "pending" : "ok";
        const values: FieldBag = {
          ...variant.style_values, ...variant.color_values, ...variant.sku_values,
          style_code: variant.style_code, style_name: variant.name, variation_theme: variant.variation_theme,
          color: variant.color_name, color_code: variant.color_code, sku: variant.sku, size: variant.size,
          barcode: variant.barcode, mrp: variant.mrp == null ? null : Number(variant.mrp),
        };
        const live = assessSku({
          values, definitions: schema.definitions, picklists: schema.picklists, taxSchedule: schema.taxSchedule,
          relationshipRules: schema.relationshipRules, channel: schema.channel, mediaStatus,
        });
        return { sku: variant.sku, values, channelReady: live.channelReady, channelMessages: live.channelMessages };
      });
    });
    skus.push(...batch);
  }
  return skus;
}

export async function publishChannelFile(tenantId: string, userId: string, catalogId: string) {
  const schema = await withTenant(tenantId, userId, (client) => loadSchema(client, catalogId));
  const skus = await loadExportSkus(tenantId, userId, catalogId);
  const preview = buildChannelMatrix(schema.channel, skus);
  const csv = Papa.unparse({ fields: preview.headers, data: preview.matrix });
  const templatePath = path.join(process.cwd(), schema.channel.templateFile);
  const template = await fs.readFile(templatePath);
  const xlsx = await injectChannelRows(template, schema.channel, preview.matrix);
  const stamp = randomUUID();
  const csvKey = `tenants/${tenantId}/exports/${stamp}.csv`;
  const xlsxKey = `tenants/${tenantId}/exports/${stamp}.xlsx`;
  await objectStore().put(csvKey, Buffer.from(csv), "text/csv");
  await objectStore().put(xlsxKey, xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const summary = {
    parentRows: preview.parentRows,
    childRows: preview.childRows,
    blocked: preview.blocked.length,
    blockedSkus: preview.blocked.slice(0, 50),
  };
  const exportId = await withTenant(tenantId, userId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO export_jobs (tenant_id, catalog_id, channel_key, status, summary, result_object_key, receipt, idempotency_key, created_by)
       VALUES ($1,$2,$3,'completed',$4::jsonb,$5,$6::jsonb,$7,$8) RETURNING id`,
      [tenantId, catalogId, schema.channel.key, JSON.stringify(summary), xlsxKey, JSON.stringify({ csvKey, xlsxKey, ...summary }), stamp, userId],
    );
    await writeAudit(client, {
      tenantId, actorId: userId, source: "channel", entityType: "export_job", entityId: inserted.rows[0].id,
      operation: "export", after: summary, note: schema.channel.name,
    });
    return inserted.rows[0].id;
  });
  return { exportId, summary, csvKey, xlsxKey };
}
