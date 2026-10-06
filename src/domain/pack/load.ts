import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AttributeDefinition, PackDefinition, TaxSchedule } from "../types";
import { activeTaxSchedule } from "../quality/tax";

export function packOrigin(pack: PackDefinition): string {
  return `${pack.key}@${pack.version}`;
}

export function definitionsFromPack(pack: PackDefinition): AttributeDefinition[] {
  const origin = packOrigin(pack);
  return pack.attributes.map((attribute) => ({
    ...attribute,
    rules: attribute.rules ?? {},
    packOrigin: origin,
  }));
}

export function hsnPicklist(schedule: TaxSchedule) {
  return {
    key: "hsn_code",
    values: schedule.hsn.map((entry) => ({ value: entry.code, label: `${entry.code} — ${entry.label}` })),
  };
}

export function assertPack(pack: PackDefinition): void {
  if (!pack.key || !pack.version) throw new Error("Pack key and version are required.");
  if (pack.attributes.length < 10) throw new Error("Pack is missing attribute definitions.");
  activeTaxSchedule(pack.taxSchedules);
  const groups = new Set(pack.attributes.map((attribute) => attribute.groupKey));
  for (const required of ["variation", "legal_metrology", "business_identity", "taxation", "consumer_sizing", "media"]) {
    if (!groups.has(required)) throw new Error(`Pack is missing the ${required} group.`);
  }
}

export function loadKidswearPack(root = process.cwd()): { pack: PackDefinition; checksum: string } {
  const file = path.join(root, "packs/kidswear/v1.json");
  const raw = fs.readFileSync(file, "utf8");
  const pack = JSON.parse(raw) as PackDefinition;
  assertPack(pack);
  const checksum = createHash("sha256").update(raw).digest("hex");
  return { pack, checksum };
}
