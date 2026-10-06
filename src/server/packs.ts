import type { PoolClient } from "pg";
import { definitionsFromPack, hsnPicklist, loadKidswearPack, packOrigin } from "@/domain/pack/load";
import { mergePackDefinitions } from "@/domain/pack/merge";
import { activeTaxSchedule } from "@/domain/quality/tax";
import type { AttributeDefinition, TenantOverride } from "@/domain/types";
import { writeAudit } from "./audit";

async function valueCounts(client: PoolClient, catalogId: string): Promise<Record<string, number>> {
  const result = await client.query<{ key: string; n: string }>(
    `SELECT key, count(*)::text AS n FROM (
       SELECT jsonb_object_keys(values) AS key FROM products WHERE catalog_id = $1
       UNION ALL
       SELECT jsonb_object_keys(values) FROM product_color_groups WHERE catalog_id = $1
       UNION ALL
       SELECT jsonb_object_keys(values) FROM variants WHERE catalog_id = $1
     ) keys GROUP BY key`,
    [catalogId],
  );
  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.n)]));
}

export async function installKidswearPack(client: PoolClient, args: {
  tenantId: string;
  catalogId: string;
  userId: string;
  acceptPackChanges?: boolean;
  overrides?: TenantOverride[];
}) {
  const { pack, checksum } = loadKidswearPack();
  const origin = packOrigin(pack);
  const existingInstall = await client.query<{ overrides: TenantOverride[] }>(
    `SELECT overrides FROM pack_installations WHERE catalog_id = $1 AND pack_key = $2`,
    [args.catalogId, pack.key],
  );
  const overrides = args.overrides ?? existingInstall.rows[0]?.overrides ?? [];
  const current = await client.query<{
    key: string; label: string; data_type: "text"; scope: "style"; group_key: string; group_label: string;
    sort_order: number; required: boolean; help: string | null; rules: Record<string, unknown>; pack_origin: string | null;
  }>(`SELECT * FROM attribute_definitions WHERE catalog_id = $1`, [args.catalogId]);
  const installed: AttributeDefinition[] = current.rows.map((row) => ({
    key: row.key,
    label: row.label,
    dataType: row.data_type,
    scope: row.scope,
    groupKey: row.group_key,
    groupLabel: row.group_label,
    sortOrder: row.sort_order,
    required: row.required,
    help: row.help ?? undefined,
    rules: (row.rules ?? {}) as AttributeDefinition["rules"],
    packOrigin: row.pack_origin,
  }));
  const merged = mergePackDefinitions({
    packAttributes: definitionsFromPack(pack),
    installed,
    overrides,
    valueCounts: await valueCounts(client, args.catalogId),
    acceptPackChanges: args.acceptPackChanges ?? true,
  });
  const blocking = merged.conflicts.filter((conflict) => conflict.kind !== "pack_change_needs_acceptance" || !args.acceptPackChanges);
  if (blocking.length && !args.acceptPackChanges) {
    return { applied: false, checksum, conflicts: merged.conflicts, definitions: installed };
  }

  await client.query(`DELETE FROM attribute_definitions WHERE catalog_id = $1`, [args.catalogId]);
  for (const def of merged.definitions) {
    await client.query(
      `INSERT INTO attribute_definitions
        (tenant_id, catalog_id, key, label, data_type, scope, group_key, group_label, sort_order, required, help, rules, pack_origin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
      [
        args.tenantId, args.catalogId, def.key, def.label, def.dataType, def.scope, def.groupKey, def.groupLabel,
        def.sortOrder, def.required, def.help ?? null, JSON.stringify(def.rules), def.packOrigin,
      ],
    );
  }

  const schedule = activeTaxSchedule(pack.taxSchedules);
  const picklists = [...pack.picklists.filter((list) => list.key !== "hsn_code"), hsnPicklist(schedule)];
  await client.query(`DELETE FROM picklists WHERE catalog_id = $1`, [args.catalogId]);
  for (const list of picklists) {
    await client.query(
      `INSERT INTO picklists (tenant_id, catalog_id, key, version, values) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [args.tenantId, args.catalogId, list.key, pack.version, JSON.stringify(list.values)],
    );
  }

  await client.query(
    `INSERT INTO tax_schedules (tenant_id, catalog_id, schedule_key, status, effective_from, definition, installed_from_pack)
     VALUES ($1,$2,$3,'active_candidate',$4,$5::jsonb,$6)
     ON CONFLICT (catalog_id, schedule_key) DO UPDATE
     SET status = 'active_candidate', effective_from = EXCLUDED.effective_from, definition = EXCLUDED.definition, installed_from_pack = EXCLUDED.installed_from_pack`,
    [args.tenantId, args.catalogId, schedule.id, schedule.effectiveFrom, JSON.stringify(schedule), origin],
  );

  const channel = pack.channels[0];
  await client.query(
    `INSERT INTO channel_profiles (tenant_id, catalog_id, key, name, format, template_file, spec)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (catalog_id, key) DO UPDATE SET name = EXCLUDED.name, spec = EXCLUDED.spec, template_file = EXCLUDED.template_file`,
    [args.tenantId, args.catalogId, channel.key, channel.name, channel.format, channel.templateFile, JSON.stringify(channel)],
  );

  await client.query(
    `INSERT INTO pack_installations (tenant_id, catalog_id, pack_key, pack_version, overrides, installed_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (catalog_id, pack_key) DO UPDATE
     SET pack_version = EXCLUDED.pack_version, overrides = EXCLUDED.overrides, installed_by = EXCLUDED.installed_by, installed_at = now()`,
    [args.tenantId, args.catalogId, pack.key, pack.version, JSON.stringify(overrides), args.userId],
  );

  await writeAudit(client, {
    tenantId: args.tenantId,
    actorId: args.userId,
    source: "pack",
    entityType: "pack_installation",
    entityId: `${pack.key}@${pack.version}`,
    operation: existingInstall.rows[0] ? "pack_upgrade" : "pack_install",
    after: { checksum, added: merged.added, updated: merged.updated, conflicts: merged.conflicts },
    note: `Installed ${pack.name} v${pack.version}`,
  });

  return { applied: true, checksum, conflicts: merged.conflicts, definitions: merged.definitions };
}
