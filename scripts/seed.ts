import bcrypt from "bcryptjs";
import pg from "pg";
import { loadKidswearPack } from "../src/domain/pack/load";
import { installKidswearPack } from "../src/server/packs";
import { withTenant } from "../src/server/db";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  const admin = new pg.Pool({ connectionString });
  const { pack, checksum } = loadKidswearPack();
  await admin.query(
    `INSERT INTO pack_versions (pack_key, version, definition, checksum)
     VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (pack_key, version) DO UPDATE SET definition = EXCLUDED.definition, checksum = EXCLUDED.checksum`,
    [pack.key, pack.version, JSON.stringify(pack), checksum],
  );
  const email = "demo@tinynest.example";
  const passwordHash = await bcrypt.hash("tiny-nest-demo", 10);
  const existing = await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const inserted = await admin.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id`,
      [email, "Demo Owner", passwordHash],
    );
    userId = inserted.rows[0].id;
  }
  const tenant = await admin.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = 'tiny-nest'`);
  let tenantId = tenant.rows[0]?.id;
  let catalogId: string;
  if (!tenantId) {
    const created = await admin.query<{ tenant_id: string; catalog_id: string }>(
      `SELECT * FROM app_bootstrap_tenant($1, $2, $3)`,
      [userId, "Tiny Nest", "tiny-nest"],
    );
    tenantId = created.rows[0].tenant_id;
    catalogId = created.rows[0].catalog_id;
  } else {
    const catalog = await admin.query<{ id: string }>(`SELECT id FROM catalogs WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [tenantId]);
    catalogId = catalog.rows[0].id;
  }
  await withTenant(tenantId, userId, (client) => installKidswearPack(client, {
    tenantId,
    catalogId,
    userId,
    acceptPackChanges: true,
  }));
  console.log("Seeded Tiny Nest (demo@tinynest.example / tiny-nest-demo) with Kidswear Pack v1.");
  await admin.end();
  const { getAppPool } = await import("../src/server/db");
  await getAppPool().end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
