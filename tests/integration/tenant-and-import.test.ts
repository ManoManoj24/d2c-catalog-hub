import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { suggestMapping } from "@/domain/import/mapping";
import { commitImport, inspectImport, refreshMediaQuality, validateImport } from "@/server/importer";
import { withTenant } from "@/server/db";
import { getAppPool } from "@/server/db";
import { objectStore } from "@/server/object-store";
import { installKidswearPack } from "@/server/packs";
import { publishChannelFile } from "@/server/publisher";
import { loadSchema } from "@/server/schema";

async function migrate() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pim_app') THEN
          CREATE ROLE pim_app LOGIN PASSWORD 'pim_app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        ELSE
          ALTER ROLE pim_app WITH LOGIN PASSWORD 'pim_app' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END
      $$;
    `);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.join(process.cwd(), "db/migrations");
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
      const done = await client.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [file]);
      if (done.rowCount) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [file]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

async function reset() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`TRUNCATE
    audit_events, jobs, export_jobs, import_rows, import_jobs, media_references, variants,
    product_color_groups, products, channel_profiles, tax_schedules, picklists, attribute_definitions,
    pack_installations, memberships, catalogs, tenants, users, pack_versions
    RESTART IDENTITY CASCADE`);
  await pool.end();
}

async function workspace(email: string, slug: string) {
  const pool = getAppPool();
  const user = await pool.query<{ app_insert_user: string }>(`SELECT app_insert_user($1, $2, $3)`, [email, slug, "hash"]);
  const tenant = await pool.query<{ tenant_id: string; catalog_id: string }>(`SELECT * FROM app_bootstrap_tenant($1, $2, $3)`, [user.rows[0].app_insert_user, slug, slug]);
  const userId = user.rows[0].app_insert_user;
  const tenantId = tenant.rows[0].tenant_id;
  const catalogId = tenant.rows[0].catalog_id;
  await withTenant(tenantId, userId, (client) => installKidswearPack(client, { tenantId, catalogId, userId, acceptPackChanges: true }));
  return { userId, tenantId, catalogId };
}

beforeAll(async () => {
  await migrate();
  await reset();
});

afterAll(async () => {
  await getAppPool().end();
});

it("hides one tenant's catalog from another, including a forged tenant id", async () => {
  const a = await workspace("a@example.com", "brand-a");
  const b = await workspace("b@example.com", "brand-b");
  await withTenant(a.tenantId, a.userId, (client) => client.query(
    `INSERT INTO products (tenant_id, catalog_id, style_code, name, variation_theme) VALUES ($1,$2,'ST-1','Secret','SizeColor')`,
    [a.tenantId, a.catalogId],
  ));
  const asB = await withTenant(b.tenantId, b.userId, (client) => client.query(`SELECT style_code FROM products`));
  expect(asB.rows).toEqual([]);
  await expect(withTenant(a.tenantId, b.userId, (client) => client.query(`SELECT style_code FROM products`))).resolves.toMatchObject({ rows: [] });
  const asA = await withTenant(a.tenantId, a.userId, (client) => client.query(`SELECT style_code FROM products`));
  expect(asA.rows.map((row) => row.style_code)).toEqual(["ST-1"]);
});

it("imports a kidswear file once, keeps colorway media shared, and exports ready rows", async () => {
  const brand = await workspace("import@example.com", "brand-import");
  const csv = fs.readFileSync(path.join(process.cwd(), "samples/kidswear-catalog.csv"));
  const key = `tenants/${brand.tenantId}/imports/demo/source.csv`;
  await objectStore().put(key, csv, "text/csv");
  const job = await withTenant(brand.tenantId, brand.userId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO import_jobs (tenant_id, catalog_id, status, file_object_key, file_name, file_size, mode, idempotency_key, created_by)
       VALUES ($1,$2,'uploaded',$3,'kidswear-catalog.csv',$4,'atomic',$5,$6) RETURNING id`,
      [brand.tenantId, brand.catalogId, key, csv.length, `job-${brand.tenantId}`, brand.userId],
    );
    return inserted.rows[0].id;
  });
  await inspectImport(brand.tenantId, brand.userId, job);
  const schema = await withTenant(brand.tenantId, brand.userId, (client) => loadSchema(client, brand.catalogId));
  const inspected = await withTenant(brand.tenantId, brand.userId, (client) => client.query<{ headers: string[]; status: string }>(
    `SELECT headers, status FROM import_jobs WHERE id = $1`,
    [job],
  ));
  expect(inspected.rows[0].status).toBe("mapping_required");
  const mapping = Object.fromEntries(suggestMapping(inspected.rows[0].headers, schema.definitions).map((item) => [item.column, item.attributeKey]));
  await withTenant(brand.tenantId, brand.userId, (client) => client.query(
    `UPDATE import_jobs SET mapping = $2::jsonb, status = 'mapping_required' WHERE id = $1`,
    [job, JSON.stringify(mapping)],
  ));
  await validateImport(brand.tenantId, brand.userId, job);
  const summary = await withTenant(brand.tenantId, brand.userId, (client) => client.query<{ summary: { blocked: boolean; errorCount: number; creates: number } }>(
    `SELECT summary FROM import_jobs WHERE id = $1`,
    [job],
  ));
  expect(summary.rows[0].summary.blocked).toBe(false);
  expect(summary.rows[0].summary.errorCount).toBe(0);
  expect(summary.rows[0].summary.creates).toBe(6);
  await commitImport(brand.tenantId, brand.userId, job);
  await commitImport(brand.tenantId, brand.userId, job);
  const counts = await withTenant(brand.tenantId, brand.userId, async (client) => {
    const variants = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM variants WHERE catalog_id = $1`, [brand.catalogId]);
    const colors = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM product_color_groups WHERE catalog_id = $1`, [brand.catalogId]);
    const media = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM media_references WHERE catalog_id = $1 AND role = 'main'`,
      [brand.catalogId],
    );
    return { variants: Number(variants.rows[0].n), colors: Number(colors.rows[0].n), mains: Number(media.rows[0].n) };
  });
  expect(counts).toEqual({ variants: 6, colors: 4, mains: 4 });
  await withTenant(brand.tenantId, brand.userId, async (client) => {
    await client.query(`UPDATE media_references SET check_result = 'ok', content_type = 'image/png', http_status = 200 WHERE catalog_id = $1`, [brand.catalogId]);
    const ids = await client.query<{ id: string }>(`SELECT id FROM product_color_groups WHERE catalog_id = $1`, [brand.catalogId]);
    await refreshMediaQuality(client, brand.catalogId, ids.rows.map((row) => row.id));
  });
  const exported = await publishChannelFile(brand.tenantId, brand.userId, brand.catalogId);
  expect(exported.summary.childRows).toBe(6);
  expect(exported.summary.parentRows).toBe(3);
  expect(exported.summary.blocked).toBe(0);
  const file = await objectStore().get(exported.csvKey);
  expect(file?.body.toString("utf8")).toContain("Parent");
  expect(file?.body.toString("utf8")).toContain("KW-ROMP-01-SKY-0-3M");
  const audits = await withTenant(brand.tenantId, brand.userId, (client) => client.query(
    `SELECT count(*)::text AS n FROM audit_events WHERE operation = 'import_commit'`,
  ));
  expect(Number(audits.rows[0].n)).toBe(1);
});
