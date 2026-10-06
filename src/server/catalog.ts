import { assessSku } from "@/domain/quality/assess";
import { validateFlatRecord } from "@/domain/quality/validate";
import type { FieldBag, ProductStatus } from "@/domain/types";
import { coerceAttribute } from "@/domain/quality/fields";
import { writeAudit } from "./audit";
import { withTenant } from "./db";
import { loadSchema } from "./schema";

export type SkuListRow = {
  id: string;
  sku: string;
  size: string | null;
  mrp: number | null;
  status: string;
  updatedAt: string;
  styleCode: string;
  name: string;
  productId: string;
  colorName: string;
  quality: {
    completenessPct?: number;
    missing?: string[];
    issueCount?: number;
    warningCount?: number;
    channelReady?: boolean;
    channelMessages?: string[];
  };
};

export async function dashboard(tenantId: string, userId: string, catalogId: string) {
  return withTenant(tenantId, userId, async (client) => {
    const counts = await client.query<{ styles: string; skus: string; ready: string; imports: string }>(
      `SELECT
         (SELECT count(*) FROM products WHERE catalog_id = $1)::text AS styles,
         (SELECT count(*) FROM variants WHERE catalog_id = $1)::text AS skus,
         (SELECT count(*) FROM variants WHERE catalog_id = $1 AND quality->>'channelReady' = 'true')::text AS ready,
         (SELECT count(*) FROM import_jobs WHERE catalog_id = $1 AND status NOT IN ('completed', 'failed', 'cancelled'))::text AS imports`,
      [catalogId],
    );
    const latest = await client.query<{ id: string; file_name: string; status: string; summary: { creates?: number; errorCount?: number } }>(
      `SELECT id, file_name, status, summary FROM import_jobs WHERE catalog_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [catalogId],
    );
    return { counts: counts.rows[0], latest: latest.rows[0] ?? null };
  });
}

export async function listSkus(tenantId: string, userId: string, catalogId: string, filter: {
  q?: string; status?: string; ready?: string; page?: number;
}) {
  const page = Math.max(1, filter.page ?? 1);
  const limit = 50;
  return withTenant(tenantId, userId, async (client) => {
    const where = [`v.catalog_id = $1`];
    const params: unknown[] = [catalogId];
    if (filter.status) {
      params.push(filter.status);
      where.push(`v.status = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q}%`);
      where.push(`(v.sku ILIKE $${params.length} OR p.name ILIKE $${params.length} OR p.style_code ILIKE $${params.length})`);
    }
    if (filter.ready === "yes") where.push(`v.quality->>'channelReady' = 'true'`);
    if (filter.ready === "no") where.push(`COALESCE(v.quality->>'channelReady','false') <> 'true'`);
    const whereSql = where.join(" AND ");
    const total = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM variants v JOIN products p ON p.id = v.product_id WHERE ${whereSql}`,
      params,
    );
    params.push(limit, (page - 1) * limit);
    const rows = await client.query<{
      id: string; sku: string; size: string | null; mrp: string | null; status: string; updated_at: string;
      style_code: string; name: string; product_id: string; color_name: string; quality: SkuListRow["quality"];
    }>(
      `SELECT v.id, v.sku, v.size, v.mrp::text, v.status, v.updated_at::text, v.quality,
              p.style_code, p.name, p.id AS product_id, c.color_name
       FROM variants v
       JOIN products p ON p.id = v.product_id
       JOIN product_color_groups c ON c.id = v.color_group_id
       WHERE ${whereSql}
       ORDER BY v.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total: Number(total.rows[0]?.n ?? 0),
      page,
      rows: rows.rows.map((row) => ({
        id: row.id,
        sku: row.sku,
        size: row.size,
        mrp: row.mrp == null ? null : Number(row.mrp),
        status: row.status,
        updatedAt: row.updated_at,
        styleCode: row.style_code,
        name: row.name,
        productId: row.product_id,
        colorName: row.color_name,
        quality: row.quality ?? {},
      })),
    };
  });
}

function mergeBag(base: FieldBag, definitions: { key: string; scope: string; dataType: "text" }[], scope: string, form: FormData, prefix: string) {
  const next = { ...base };
  for (const def of definitions) {
    if (def.scope !== scope) continue;
    const raw = form.get(`${prefix}${def.key}`);
    if (typeof raw !== "string") continue;
    next[def.key] = coerceAttribute(def as never, raw);
  }
  return next;
}

export async function saveProduct(tenantId: string, userId: string, catalogId: string, productId: string, form: FormData) {
  return withTenant(tenantId, userId, async (client) => {
    const schema = await loadSchema(client, catalogId);
    const product = await client.query<{ id: string; style_code: string; name: string; variation_theme: string; values: FieldBag; status: string }>(
      `SELECT id, style_code, name, variation_theme, values, status FROM products WHERE id = $1 AND catalog_id = $2`,
      [productId, catalogId],
    );
    if (!product.rows[0]) throw new Error("Style not found.");
    const styleValues = mergeBag(product.rows[0].values, schema.definitions as never, "style", form, "style.");
    const styleName = String(styleValues.style_name ?? product.rows[0].name);
    const theme = String(styleValues.variation_theme ?? product.rows[0].variation_theme);
    const status = String(form.get("status") ?? product.rows[0].status) as ProductStatus;
    if (!["draft", "approved", "archived"].includes(status)) throw new Error("Unknown status.");

    const colors = await client.query<{ id: string; color_code: string; color_name: string; values: FieldBag }>(
      `SELECT id, color_code, color_name, values FROM product_color_groups WHERE product_id = $1`,
      [productId],
    );
    const variants = await client.query<{
      id: string; sku: string; size: string | null; barcode: string | null; mrp: string | null; values: FieldBag; color_group_id: string; status: string;
    }>(`SELECT id, sku, size, barcode, mrp::text, values, color_group_id, status FROM variants WHERE product_id = $1`, [productId]);
    const media = await client.query<{ color_group_id: string; role: string; check_result: "ok" | "pending" | "failed" }>(
      `SELECT color_group_id, role, check_result FROM media_references WHERE product_id = $1 AND scope = 'colorway'`,
      [productId],
    );

    const colorNext = new Map<string, FieldBag>();
    for (const color of colors.rows) {
      colorNext.set(color.id, mergeBag(color.values, schema.definitions as never, "colorway", form, `color.${color.id}.`));
    }
    const messages: string[] = [];
    for (const variant of variants.rows) {
      const skuValues = mergeBag(variant.values, schema.definitions as never, "sku", form, `sku.${variant.id}.`);
      const color = colors.rows.find((item) => item.id === variant.color_group_id);
      const colorValues = colorNext.get(variant.color_group_id) ?? {};
      const flat: FieldBag = {
        ...styleValues, ...colorValues, ...skuValues,
        style_code: product.rows[0].style_code,
        style_name: styleName,
        variation_theme: theme,
        color: colorValues.color ?? color?.color_name,
        color_code: color?.color_code,
        sku: variant.sku,
        size: skuValues.size ?? variant.size,
        barcode: skuValues.barcode ?? variant.barcode,
        mrp: typeof skuValues.mrp === "number" ? skuValues.mrp : variant.mrp == null ? null : Number(variant.mrp),
      };
      messages.push(...validateFlatRecord({
        values: flat,
        definitions: schema.definitions,
        picklists: schema.picklists,
        taxSchedule: schema.taxSchedule,
        relationshipRules: schema.relationshipRules,
      }).filter((issue) => issue.severity === "error").map((issue) => `${variant.sku}: ${issue.message}`));
    }
    if (messages.length) throw new Error(messages.slice(0, 3).join(" "));

    await client.query(
      `UPDATE products SET name = $2, variation_theme = $3, values = $4::jsonb, status = $5, updated_at = now() WHERE id = $1`,
      [productId, styleName, theme, JSON.stringify(styleValues), status],
    );
    await writeAudit(client, {
      tenantId, actorId: userId, source: "ui", entityType: "product", entityId: productId, operation: "update",
      before: { name: product.rows[0].name, status: product.rows[0].status, ...product.rows[0].values },
      after: { name: styleName, status, ...styleValues },
    });
    for (const color of colors.rows) {
      const values = colorNext.get(color.id) ?? color.values;
      await client.query(`UPDATE product_color_groups SET color_name = $2, values = $3::jsonb, updated_at = now() WHERE id = $1`, [
        color.id, String(values.color ?? color.color_name), JSON.stringify(values),
      ]);
    }
    for (const variant of variants.rows) {
      const skuValues = mergeBag(variant.values, schema.definitions as never, "sku", form, `sku.${variant.id}.`);
      const colorValues = colorNext.get(variant.color_group_id) ?? {};
      const mains = media.rows.filter((item) => item.color_group_id === variant.color_group_id && item.role === "main");
      const mediaStatus = mains.length === 0 ? "missing" : mains.some((item) => item.check_result === "failed") ? "failed" : mains.some((item) => item.check_result === "pending") ? "pending" : "ok";
      const flat: FieldBag = {
        ...styleValues, ...colorValues, ...skuValues,
        style_code: product.rows[0].style_code, style_name: styleName, variation_theme: theme,
        color: colorValues.color, sku: variant.sku,
        mrp: typeof skuValues.mrp === "number" ? skuValues.mrp : null,
      };
      const quality = assessSku({
        values: flat, definitions: schema.definitions, picklists: schema.picklists, taxSchedule: schema.taxSchedule,
        relationshipRules: schema.relationshipRules, channel: schema.channel, mediaStatus,
      });
      await client.query(
        `UPDATE variants SET size = $2, mrp = $3, barcode = $4, values = $5::jsonb, quality = $6::jsonb, status = $7, updated_at = now() WHERE id = $1`,
        [variant.id, String(skuValues.size ?? variant.size ?? ""), typeof skuValues.mrp === "number" ? skuValues.mrp : null, (skuValues.barcode as string | null) ?? null, JSON.stringify(skuValues), JSON.stringify(quality), status],
      );
    }
  });
}

export async function bulkStatus(tenantId: string, userId: string, catalogId: string, ids: string[], status: ProductStatus) {
  if (!ids.length) return;
  await withTenant(tenantId, userId, async (client) => {
    await client.query(`UPDATE variants SET status = $3, updated_at = now() WHERE catalog_id = $1 AND id = ANY($2::uuid[])`, [catalogId, ids, status]);
    await client.query(
      `UPDATE products SET status = $3, updated_at = now() WHERE catalog_id = $1 AND id IN (SELECT product_id FROM variants WHERE id = ANY($2::uuid[]))`,
      [catalogId, ids, status],
    );
    await writeAudit(client, {
      tenantId, actorId: userId, source: "ui", entityType: "variant", entityId: ids.join(","), operation: "update",
      after: { status, count: ids.length }, note: "Bulk status change",
    });
  });
}
