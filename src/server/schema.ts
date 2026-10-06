import type { PoolClient } from "pg";
import type { AttributeDefinition, ChannelSpec, DataType, Picklist, RelationshipRule, Scope, TaxSchedule } from "@/domain/types";
import { loadKidswearPack } from "@/domain/pack/load";

type DefRow = {
  key: string;
  label: string;
  data_type: DataType;
  scope: Scope;
  group_key: string;
  group_label: string;
  sort_order: number;
  required: boolean;
  help: string | null;
  rules: AttributeDefinition["rules"];
  pack_origin: string | null;
};

export async function loadSchema(client: PoolClient, catalogId: string) {
  const defs = await client.query<DefRow>(
    `SELECT key, label, data_type, scope, group_key, group_label, sort_order, required, help, rules, pack_origin
     FROM attribute_definitions WHERE catalog_id = $1 ORDER BY sort_order, key`,
    [catalogId],
  );
  const lists = await client.query<{ key: string; values: Picklist["values"] }>(
    `SELECT key, values FROM picklists WHERE catalog_id = $1`,
    [catalogId],
  );
  const tax = await client.query<{ definition: TaxSchedule }>(
    `SELECT definition FROM tax_schedules WHERE catalog_id = $1 AND status = 'active_candidate' ORDER BY created_at DESC LIMIT 1`,
    [catalogId],
  );
  const channel = await client.query<{ spec: ChannelSpec }>(
    `SELECT spec FROM channel_profiles WHERE catalog_id = $1 AND key = 'generic_marketplace'`,
    [catalogId],
  );
  const installation = await client.query<{ overrides: unknown; pack_version: number }>(
    `SELECT overrides, pack_version FROM pack_installations WHERE catalog_id = $1 AND pack_key = 'kidswear'`,
    [catalogId],
  );
  if (!tax.rows[0] || !channel.rows[0]) throw new Error("Kidswear pack is not installed for this catalog.");
  const pack = loadKidswearPack().pack;
  return {
    definitions: defs.rows.map((row) => ({
      key: row.key,
      label: row.label,
      dataType: row.data_type,
      scope: row.scope,
      groupKey: row.group_key,
      groupLabel: row.group_label,
      sortOrder: row.sort_order,
      required: row.required,
      help: row.help ?? undefined,
      rules: row.rules ?? {},
      packOrigin: row.pack_origin,
    })) satisfies AttributeDefinition[],
    picklists: lists.rows.map((row) => ({ key: row.key, values: row.values })),
    taxSchedule: tax.rows[0].definition,
    channel: channel.rows[0].spec,
    relationshipRules: pack.relationshipRules as RelationshipRule[],
    packVersion: installation.rows[0]?.pack_version ?? pack.version,
    overrides: (installation.rows[0]?.overrides ?? []) as { key: string; label?: string; required?: boolean; enabled?: boolean }[],
  };
}
