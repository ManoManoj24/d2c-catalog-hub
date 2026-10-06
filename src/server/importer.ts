import type { PoolClient } from "pg";
import { commitFingerprint } from "@/domain/import/plan";
import { planImport, rowsFromMapping } from "@/domain/import/plan";
import { suggestMapping } from "@/domain/import/mapping";
import { assessSku } from "@/domain/quality/assess";
import type { CommitRow, FieldBag } from "@/domain/types";
import { writeAudit } from "./audit";
import { withTenant } from "./db";
import { batchSize } from "./env";
import { loadKidswearPack } from "@/domain/pack/load";
import { objectStore } from "./object-store";
import { parseTabular } from "./parse-table";
import { loadSchema } from "./schema";

function flatOf(row: CommitRow): FieldBag {
  return {
    ...row.styleValues,
    ...row.colorValues,
    ...row.skuValues,
    style_code: row.styleCode,
    style_name: row.styleName,
    variation_theme: row.variationTheme,
    color: row.colorName,
    color_code: row.colorCode,
    sku: row.sku,
    size: row.size,
    barcode: row.barcode,
    mrp: row.mrp,
  };
}

async function existingFingerprints(client: PoolClient, catalogId: string, schema: Awaited<ReturnType<typeof loadSchema>>) {
  const result = await client.query<{
    sku: string; size: string | null; barcode: string | null; mrp: string | null; sku_values: FieldBag;
    style_code: string; name: string; variation_theme: string; style_values: FieldBag;
    color_code: string; color_name: string; color_values: FieldBag;
    color_group_id: string;
  }>(
    `SELECT v.sku, v.size, v.barcode, v.mrp::text, v.values AS sku_values,
            p.style_code, p.name, p.variation_theme, p.values AS style_values,
            c.color_code, c.color_name, c.values AS color_values, c.id AS color_group_id
     FROM variants v
     JOIN products p ON p.id = v.product_id
     JOIN product_color_groups c ON c.id = v.color_group_id
     WHERE v.catalog_id = $1`,
    [catalogId],
  );
  const media = await client.query<{ color_group_id: string; role: "main" | "alternate"; source_url: string | null }>(
    `SELECT color_group_id, role, source_url FROM media_references WHERE catalog_id = $1 AND scope = 'colorway'`,
    [catalogId],
  );
  const mediaByColor = new Map<string, { role: "main" | "alternate"; url: string }[]>();
  for (const row of media.rows) {
    if (!row.source_url) continue;
    const list = mediaByColor.get(row.color_group_id) ?? [];
    list.push({ role: row.role, url: row.source_url });
    mediaByColor.set(row.color_group_id, list);
  }
  const fingerprints: Record<string, string> = {};
  for (const row of result.rows) {
    const draft: CommitRow = {
      action: "unchanged",
      rowNumber: 0,
      styleCode: row.style_code,
      styleName: row.name,
      variationTheme: row.variation_theme,
      styleValues: row.style_values ?? {},
      colorCode: row.color_code,
      colorName: row.color_name,
      colorValues: row.color_values ?? {},
      media: (mediaByColor.get(row.color_group_id) ?? []).sort((a, b) => a.role.localeCompare(b.role)),
      sku: row.sku,
      size: row.size ?? "",
      barcode: row.barcode,
      mrp: row.mrp == null ? null : Number(row.mrp),
      skuValues: row.sku_values ?? {},
      issues: [],
    };
    fingerprints[row.sku] = commitFingerprint(draft);
  }
  void schema;
  return fingerprints;
}

export async function inspectImport(tenantId: string, userId: string, importJobId: string): Promise<void> {
  const current = await withTenant(tenantId, userId, async (client) => {
    const job = await client.query<{
      id: string; catalog_id: string; file_object_key: string; file_name: string; status: string;
    }>(`SELECT id, catalog_id, file_object_key, file_name, status FROM import_jobs WHERE id = $1`, [importJobId]);
    const row = job.rows[0];
    if (!row) throw new Error("Import job not found.");
    if (row.status !== "uploaded" && row.status !== "inspecting") return null;
    await client.query(`UPDATE import_jobs SET status = 'inspecting', updated_at = now() WHERE id = $1`, [importJobId]);
    return row;
  });
  if (!current) return;
  const file = await objectStore().get(current.file_object_key);
  if (!file) throw new Error("Import file is missing from object storage.");
  const limits = loadKidswearPack().pack.limits;
  const parsed = await parseTabular(current.file_name, file.body, { maxRows: limits.maxImportRows, maxCellLength: limits.maxCellLength });
  await withTenant(tenantId, userId, async (client) => {
    if (parsed.errors.length || parsed.headers.length === 0) {
      await client.query(
        `UPDATE import_jobs SET status = 'failed', error_summary = $2, updated_at = now() WHERE id = $1`,
        [importJobId, parsed.errors.join(" ") || "No headers found."],
      );
      return;
    }
    const schema = await loadSchema(client, current.catalog_id);
    const suggestions = suggestMapping(parsed.headers, schema.definitions);
    await client.query(
      `UPDATE import_jobs
       SET status = 'mapping_required', headers = $2::jsonb, sample_rows = $3::jsonb, suggestions = $4::jsonb, error_summary = NULL, updated_at = now()
       WHERE id = $1`,
      [importJobId, JSON.stringify(parsed.headers), JSON.stringify(parsed.rows.slice(0, 3)), JSON.stringify(suggestions)],
    );
  });
}

export async function validateImport(tenantId: string, userId: string, importJobId: string): Promise<void> {
  const loaded = await withTenant(tenantId, userId, async (client) => {
    const job = await client.query<{
      id: string; tenant_id: string; catalog_id: string; file_object_key: string; file_name: string; mapping: Record<string, string | null>; mode: "atomic" | "partial"; status: string;
    }>(`SELECT id, tenant_id, catalog_id, file_object_key, file_name, mapping, mode, status FROM import_jobs WHERE id = $1`, [importJobId]);
    const current = job.rows[0];
    if (!current) throw new Error("Import job not found.");
    if (!["mapping_required", "staging", "validating", "review_required"].includes(current.status)) return null;
    const staged = await client.query<{ values: FieldBag; row_number: number; issues: { rule: string }[] }>(
      `SELECT values, row_number, issues FROM import_rows WHERE import_job_id = $1 ORDER BY row_number`,
      [importJobId],
    );
    const progress = await client.query<{ progress: { phase?: string } }>(`SELECT progress FROM import_jobs WHERE id = $1`, [importJobId]);
    await client.query(`UPDATE import_jobs SET status = 'validating', updated_at = now() WHERE id = $1`, [importJobId]);
    const schema = await loadSchema(client, current.catalog_id);
    const fingerprints = await existingFingerprints(client, current.catalog_id, schema);
    return {
      current,
      schema,
      fingerprints,
      staged: progress.rows[0]?.progress?.phase === "revalidate_staged" ? staged.rows : null,
    };
  });
  if (!loaded) return;
  let mapped;
  if (loaded.staged) {
    mapped = loaded.staged.map((row) => ({
      rowNumber: row.row_number,
      raw: {},
      values: row.values,
      formulaCells: (row.issues ?? []).some((issue) => issue.rule === "formula_neutralized") ? ["formula"] : [],
    }));
  } else {
    const file = await objectStore().get(loaded.current.file_object_key);
    if (!file) throw new Error("Import file is missing from object storage.");
    const limits = loadKidswearPack().pack.limits;
    const parsed = await parseTabular(loaded.current.file_name, file.body, { maxRows: limits.maxImportRows, maxCellLength: limits.maxCellLength });
    mapped = rowsFromMapping(parsed.rows, loaded.current.mapping ?? {}, loaded.schema.definitions).map((row, index) => ({
      ...row,
      formulaCells: parsed.rows[index]?.formulaCells ?? [],
    }));
  }
  const plan = planImport({
    rows: mapped,
    definitions: loaded.schema.definitions,
    picklists: loaded.schema.picklists,
    taxSchedule: loaded.schema.taxSchedule,
    relationshipRules: loaded.schema.relationshipRules,
    existingFingerprints: loaded.fingerprints,
    mode: loaded.current.mode,
  });
  await withTenant(tenantId, userId, async (client) => {
    await client.query(`DELETE FROM import_rows WHERE import_job_id = $1`, [importJobId]);
  });
  const size = batchSize();
  for (let offset = 0; offset < plan.rows.length; offset += size) {
    const slice = plan.rows.slice(offset, offset + size);
    await withTenant(tenantId, userId, async (client) => {
      for (const row of slice) {
        await client.query(
          `INSERT INTO import_rows (tenant_id, import_job_id, row_number, raw, values, action, issues, sku, style_code)
           VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8,$9)`,
          [loaded.current.tenant_id, importJobId, row.rowNumber, JSON.stringify({ rowNumber: row.rowNumber }), JSON.stringify(flatOf(row)), row.action, JSON.stringify(row.issues), row.sku, row.styleCode],
        );
      }
      await client.query(
        `UPDATE import_jobs SET progress = $2::jsonb, updated_at = now() WHERE id = $1`,
        [importJobId, JSON.stringify({ phase: "validating", processed: Math.min(offset + size, plan.rows.length), total: plan.rows.length })],
      );
    });
  }
  await withTenant(tenantId, userId, async (client) => {
    await client.query(
      `UPDATE import_jobs SET status = 'review_required', summary = $2::jsonb, progress = $3::jsonb, updated_at = now() WHERE id = $1`,
      [importJobId, JSON.stringify(plan.summary), JSON.stringify({ phase: "review", processed: plan.rows.length, total: plan.rows.length })],
    );
  });
}

async function writeColorMedia(client: PoolClient, args: {
  tenantId: string;
  catalogId: string;
  productId: string;
  colorGroupId: string;
  media: CommitRow["media"];
}) {
  for (const [index, item] of args.media.entries()) {
    const existing = await client.query<{ id: string; source_url: string | null }>(
      `SELECT id, source_url FROM media_references
       WHERE color_group_id = $1 AND role = $2 AND scope = 'colorway'`,
      [args.colorGroupId, item.role],
    );
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO media_references
          (tenant_id, catalog_id, scope, product_id, color_group_id, role, source, source_url, delivery_url, check_result, sort_order)
         VALUES ($1,$2,'colorway',$3,$4,$5,'url',$6,$6,'pending',$7)`,
        [args.tenantId, args.catalogId, args.productId, args.colorGroupId, item.role, item.url, index],
      );
    } else if (existing.rows[0].source_url !== item.url) {
      await client.query(
        `UPDATE media_references
         SET source_url = $2, delivery_url = $2, check_result = 'pending', checked_at = NULL, http_status = NULL, content_type = NULL
         WHERE id = $1`,
        [existing.rows[0].id, item.url],
      );
    }
  }
}

async function applyRow(client: PoolClient, args: {
  tenantId: string;
  catalogId: string;
  userId: string;
  importJobId: string;
  schemaVersion: number;
  row: CommitRow;
  schema: Awaited<ReturnType<typeof loadSchema>>;
}) {
  const product = await client.query<{ id: string; name: string; values: FieldBag }>(
    `SELECT id, name, values FROM products WHERE catalog_id = $1 AND style_code = $2`,
    [args.catalogId, args.row.styleCode],
  );
  let productId = product.rows[0]?.id as string | undefined;
  const styleBefore = product.rows[0] ? { name: product.rows[0].name, ...product.rows[0].values } : null;
  if (!productId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO products (tenant_id, catalog_id, style_code, name, status, variation_theme, values, schema_version)
       VALUES ($1,$2,$3,$4,'draft',$5,$6::jsonb,$7) RETURNING id`,
      [args.tenantId, args.catalogId, args.row.styleCode, args.row.styleName, args.row.variationTheme || "SizeColor", JSON.stringify(args.row.styleValues), args.schemaVersion],
    );
    productId = inserted.rows[0].id;
    await writeAudit(client, {
      tenantId: args.tenantId, actorId: args.userId, source: "import", entityType: "product", entityId: productId,
      operation: "create", after: args.row.styleValues, jobId: args.importJobId,
    });
  } else {
    await client.query(
      `UPDATE products SET name = $2, variation_theme = $3, values = $4::jsonb, schema_version = $5, updated_at = now() WHERE id = $1`,
      [productId, args.row.styleName, args.row.variationTheme || "SizeColor", JSON.stringify(args.row.styleValues), args.schemaVersion],
    );
    if (styleBefore && styleBefore.name !== args.row.styleName) {
      await writeAudit(client, {
        tenantId: args.tenantId, actorId: args.userId, source: "import", entityType: "product", entityId: productId,
        operation: "update", before: styleBefore, after: { name: args.row.styleName, ...args.row.styleValues }, jobId: args.importJobId,
      });
    }
  }

  const color = await client.query<{ id: string }>(
    `SELECT id FROM product_color_groups WHERE product_id = $1 AND color_code = $2`,
    [productId, args.row.colorCode],
  );
  let colorId = color.rows[0]?.id as string | undefined;
  if (!colorId) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO product_color_groups (tenant_id, catalog_id, product_id, color_code, color_name, values)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [args.tenantId, args.catalogId, productId, args.row.colorCode, args.row.colorName || args.row.colorCode, JSON.stringify(args.row.colorValues)],
    );
    colorId = inserted.rows[0].id;
  } else {
    await client.query(
      `UPDATE product_color_groups SET color_name = $2, values = $3::jsonb, updated_at = now() WHERE id = $1`,
      [colorId, args.row.colorName || args.row.colorCode, JSON.stringify(args.row.colorValues)],
    );
  }
  await writeColorMedia(client, {
    tenantId: args.tenantId, catalogId: args.catalogId, productId, colorGroupId: colorId, media: args.row.media,
  });

  const variant = await client.query<{ id: string; values: FieldBag; mrp: string | null }>(
    `SELECT id, values, mrp::text FROM variants WHERE catalog_id = $1 AND sku = $2`,
    [args.catalogId, args.row.sku],
  );
  const quality = assessSku({
    values: flatOf(args.row),
    definitions: args.schema.definitions,
    picklists: args.schema.picklists,
    taxSchedule: args.schema.taxSchedule,
    relationshipRules: args.schema.relationshipRules,
    channel: args.schema.channel,
    mediaStatus: args.row.media.some((item) => item.role === "main") ? "pending" : "missing",
  });
  if (!variant.rows[0]) {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO variants (tenant_id, catalog_id, product_id, color_group_id, sku, barcode, size, mrp, status, values, quality)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9::jsonb,$10::jsonb) RETURNING id`,
      [args.tenantId, args.catalogId, productId, colorId, args.row.sku, args.row.barcode, args.row.size, args.row.mrp, JSON.stringify(args.row.skuValues), JSON.stringify(quality)],
    );
    await writeAudit(client, {
      tenantId: args.tenantId, actorId: args.userId, source: "import", entityType: "variant", entityId: inserted.rows[0].id,
      operation: "create", after: { sku: args.row.sku, ...args.row.skuValues }, jobId: args.importJobId,
    });
  } else {
    await client.query(
      `UPDATE variants SET product_id = $2, color_group_id = $3, barcode = $4, size = $5, mrp = $6, values = $7::jsonb, quality = $8::jsonb, updated_at = now()
       WHERE id = $1`,
      [variant.rows[0].id, productId, colorId, args.row.barcode, args.row.size, args.row.mrp, JSON.stringify(args.row.skuValues), JSON.stringify(quality)],
    );
    await writeAudit(client, {
      tenantId: args.tenantId, actorId: args.userId, source: "import", entityType: "variant", entityId: variant.rows[0].id,
      operation: "update", before: { ...variant.rows[0].values, mrp: variant.rows[0].mrp }, after: args.row.skuValues, jobId: args.importJobId,
    });
  }
}

export async function commitImport(tenantId: string, userId: string, importJobId: string): Promise<{ summary: unknown; mediaIds: string[] }> {
  const prepared = await withTenant(tenantId, userId, async (client) => {
    const job = await client.query<{
      id: string; tenant_id: string; catalog_id: string; status: string; mode: "atomic" | "partial"; summary: unknown;
    }>(`SELECT id, tenant_id, catalog_id, status, mode, summary FROM import_jobs WHERE id = $1`, [importJobId]);
    const current = job.rows[0];
    if (!current) throw new Error("Import job not found.");
    if (current.status === "completed") {
      const media = await client.query<{ id: string }>(
        `SELECT id FROM media_references WHERE catalog_id = $1 AND check_result = 'pending'`,
        [current.catalog_id],
      );
      return { done: true as const, summary: current.summary, mediaIds: media.rows.map((row) => row.id) };
    }
    if (!["review_required", "committing"].includes(current.status)) throw new Error(`Import cannot commit from ${current.status}.`);
    const schema = await loadSchema(client, current.catalog_id);
    const stored = await client.query<{ values: FieldBag; row_number: number }>(
      `SELECT values, row_number FROM import_rows WHERE import_job_id = $1 ORDER BY row_number`,
      [importJobId],
    );
    const fingerprints = await existingFingerprints(client, current.catalog_id, schema);
    const plan = planImport({
      rows: stored.rows.map((row) => ({ rowNumber: row.row_number, raw: {}, values: row.values })),
      definitions: schema.definitions,
      picklists: schema.picklists,
      taxSchedule: schema.taxSchedule,
      relationshipRules: schema.relationshipRules,
      existingFingerprints: fingerprints,
      mode: current.mode,
    });
    if (plan.summary.blocked) {
      await client.query(
        `UPDATE import_jobs SET status = 'review_required', summary = $2::jsonb, error_summary = $3, updated_at = now() WHERE id = $1`,
        [importJobId, JSON.stringify(plan.summary), "Commit is blocked until every error is resolved. Atomic mode does not write a partial catalog."],
      );
      return { done: true as const, summary: plan.summary, mediaIds: [] as string[] };
    }
    await client.query(`UPDATE import_jobs SET status = 'committing', summary = $2::jsonb, updated_at = now() WHERE id = $1`, [importJobId, JSON.stringify(plan.summary)]);
    return {
      done: false as const,
      catalogId: current.catalog_id,
      schema,
      summary: plan.summary,
      writable: plan.rows.filter((row) => row.action === "create" || row.action === "update"),
    };
  });
  if (prepared.done) return { summary: prepared.summary, mediaIds: prepared.mediaIds };

  const size = batchSize();
  for (let offset = 0; offset < prepared.writable.length; offset += size) {
    const slice = prepared.writable.slice(offset, offset + size);
    await withTenant(tenantId, userId, async (client) => {
      for (const row of slice) {
        await applyRow(client, {
          tenantId,
          catalogId: prepared.catalogId,
          userId,
          importJobId,
          schemaVersion: prepared.schema.packVersion,
          row,
          schema: prepared.schema,
        });
      }
      await client.query(
        `UPDATE import_jobs SET progress = $2::jsonb, updated_at = now() WHERE id = $1`,
        [importJobId, JSON.stringify({ phase: "committing", processed: Math.min(offset + size, prepared.writable.length), total: prepared.writable.length })],
      );
    });
  }

  return withTenant(tenantId, userId, async (client) => {
    await writeAudit(client, {
      tenantId,
      actorId: userId,
      source: "import",
      entityType: "import_job",
      entityId: importJobId,
      operation: "import_commit",
      after: prepared.summary as Record<string, unknown>,
      jobId: importJobId,
      note: "Committed staged rows by style, colorway, and SKU.",
    });
    await client.query(
      `UPDATE import_jobs SET status = 'completed', summary = $2::jsonb, error_summary = NULL, updated_at = now() WHERE id = $1`,
      [importJobId, JSON.stringify(prepared.summary)],
    );
    const media = await client.query<{ id: string }>(
      `SELECT id FROM media_references WHERE catalog_id = $1 AND check_result = 'pending'`,
      [prepared.catalogId],
    );
    return { summary: prepared.summary, mediaIds: media.rows.map((row) => row.id) };
  });
}

export async function refreshMediaQuality(client: PoolClient, catalogId: string, colorGroupIds: string[]) {
  if (colorGroupIds.length === 0) return;
  const schema = await loadSchema(client, catalogId);
  const variants = await client.query<{
    id: string; sku: string; size: string | null; barcode: string | null; mrp: string | null; sku_values: FieldBag;
    style_code: string; name: string; variation_theme: string; style_values: FieldBag;
    color_code: string; color_name: string; color_values: FieldBag; color_group_id: string;
  }>(
    `SELECT v.id, v.sku, v.size, v.barcode, v.mrp::text, v.values AS sku_values,
            p.style_code, p.name, p.variation_theme, p.values AS style_values,
            c.color_code, c.color_name, c.values AS color_values, c.id AS color_group_id
     FROM variants v
     JOIN products p ON p.id = v.product_id
     JOIN product_color_groups c ON c.id = v.color_group_id
     WHERE v.catalog_id = $1 AND c.id = ANY($2::uuid[])`,
    [catalogId, colorGroupIds],
  );
  const media = await client.query<{ color_group_id: string; role: string; check_result: "pending" | "ok" | "failed" }>(
    `SELECT color_group_id, role, check_result FROM media_references WHERE color_group_id = ANY($1::uuid[]) AND scope = 'colorway'`,
    [colorGroupIds],
  );
  for (const variant of variants.rows) {
    const mains = media.rows.filter((item) => item.color_group_id === variant.color_group_id && item.role === "main");
    const mediaStatus = mains.length === 0 ? "missing" : mains.some((item) => item.check_result === "failed")
      ? "failed"
      : mains.some((item) => item.check_result === "pending")
        ? "pending"
        : "ok";
    const values: FieldBag = {
      ...variant.style_values,
      ...variant.color_values,
      ...variant.sku_values,
      style_code: variant.style_code,
      style_name: variant.name,
      variation_theme: variant.variation_theme,
      color: variant.color_name,
      color_code: variant.color_code,
      sku: variant.sku,
      size: variant.size,
      barcode: variant.barcode,
      mrp: variant.mrp == null ? null : Number(variant.mrp),
    };
    const quality = assessSku({
      values,
      definitions: schema.definitions,
      picklists: schema.picklists,
      taxSchedule: schema.taxSchedule,
      relationshipRules: schema.relationshipRules,
      channel: schema.channel,
      mediaStatus,
    });
    await client.query(`UPDATE variants SET quality = $2::jsonb WHERE id = $1`, [variant.id, JSON.stringify(quality)]);
  }
}
