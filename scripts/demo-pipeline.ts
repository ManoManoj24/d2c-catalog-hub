import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { suggestMapping } from "../src/domain/import/mapping";
import { commitImport, inspectImport, refreshMediaQuality, validateImport } from "../src/server/importer";
import { getAppPool, withTenant } from "../src/server/db";
import { objectStore } from "../src/server/object-store";
import { publishChannelFile } from "../src/server/publisher";
import { loadSchema } from "../src/server/schema";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required. Run npm run db:setup first.");
  const admin = new pg.Pool({ connectionString });
  const owner = await admin.query<{ user_id: string; tenant_id: string; catalog_id: string }>(
    `SELECT u.id AS user_id, t.id AS tenant_id, c.id AS catalog_id
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     JOIN tenants t ON t.id = m.tenant_id
     JOIN catalogs c ON c.tenant_id = t.id
     WHERE u.email = 'demo@tinynest.example' AND t.slug = 'tiny-nest'
     ORDER BY c.created_at
     LIMIT 1`,
  );
  await admin.end();
  const brand = owner.rows[0];
  if (!brand) throw new Error("Demo tenant missing. Run npm run db:seed.");

  const csv = fs.readFileSync(path.join(process.cwd(), "samples/kidswear-catalog.csv"));
  const key = `tenants/${brand.tenant_id}/imports/demo-pipeline/source.csv`;
  await objectStore().put(key, csv, "text/csv");
  const job = await withTenant(brand.tenant_id, brand.user_id, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO import_jobs (tenant_id, catalog_id, status, file_object_key, file_name, file_size, mode, idempotency_key, created_by)
       VALUES ($1,$2,'uploaded',$3,'kidswear-catalog.csv',$4,'atomic',$5,$6) RETURNING id`,
      [brand.tenant_id, brand.catalog_id, key, csv.length, `demo-pipeline-${Date.now()}`, brand.user_id],
    );
    return inserted.rows[0].id;
  });
  await inspectImport(brand.tenant_id, brand.user_id, job);
  const schema = await withTenant(brand.tenant_id, brand.user_id, (client) => loadSchema(client, brand.catalog_id));
  const inspected = await withTenant(brand.tenant_id, brand.user_id, (client) => client.query<{ headers: string[]; status: string }>(
    `SELECT headers, status FROM import_jobs WHERE id = $1`,
    [job],
  ));
  if (inspected.rows[0]?.status !== "mapping_required") {
    throw new Error(`Inspect stopped at ${inspected.rows[0]?.status ?? "missing"}.`);
  }
  const mapping = Object.fromEntries(suggestMapping(inspected.rows[0].headers, schema.definitions).map((item) => [item.column, item.attributeKey]));
  await withTenant(brand.tenant_id, brand.user_id, (client) => client.query(
    `UPDATE import_jobs SET mapping = $2::jsonb WHERE id = $1`,
    [job, JSON.stringify(mapping)],
  ));
  await validateImport(brand.tenant_id, brand.user_id, job);
  const summary = await withTenant(brand.tenant_id, brand.user_id, (client) => client.query<{ summary: { blocked: boolean; errorCount: number } }>(
    `SELECT summary FROM import_jobs WHERE id = $1`,
    [job],
  ));
  if (summary.rows[0].summary.blocked || summary.rows[0].summary.errorCount > 0) {
    throw new Error(`Validation blocked the demo file: ${JSON.stringify(summary.rows[0].summary)}`);
  }
  await commitImport(brand.tenant_id, brand.user_id, job);
  await withTenant(brand.tenant_id, brand.user_id, async (client) => {
    await client.query(
      `UPDATE media_references SET check_result = 'ok', content_type = 'image/png', http_status = 200 WHERE catalog_id = $1 AND check_result = 'pending'`,
      [brand.catalog_id],
    );
    const ids = await client.query<{ id: string }>(`SELECT id FROM product_color_groups WHERE catalog_id = $1`, [brand.catalog_id]);
    await refreshMediaQuality(client, brand.catalog_id, ids.rows.map((row) => row.id));
  });
  const exported = await publishChannelFile(brand.tenant_id, brand.user_id, brand.catalog_id);
  const file = await objectStore().get(exported.csvKey);
  const csvText = file?.body.toString("utf8") ?? "";
  if (!csvText.includes("Parent") || !csvText.includes("KW-ROMP-01-SKY-0-3M")) {
    throw new Error("Channel CSV is missing the expected parent row or sample SKU.");
  }
  const counts = await withTenant(brand.tenant_id, brand.user_id, async (client) => {
    const variants = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM variants WHERE catalog_id = $1`, [brand.catalog_id]);
    const colors = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM product_color_groups WHERE catalog_id = $1`, [brand.catalog_id]);
    return { variants: Number(variants.rows[0].n), colors: Number(colors.rows[0].n) };
  });
  console.log(JSON.stringify({
    importJobId: job,
    variants: counts.variants,
    colorways: counts.colors,
    parentRows: exported.summary.parentRows,
    childRows: exported.summary.childRows,
    blocked: exported.summary.blocked,
    csvKey: exported.csvKey,
  }, null, 2));
  await getAppPool().end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    const { getAppPool } = await import("../src/server/db");
    await getAppPool().end();
  } catch {
    // Pool may not have opened.
  }
  process.exit(1);
});
