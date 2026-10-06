import type { PoolClient } from "pg";
import { diffFields } from "@/domain/diff";

export async function writeAudit(client: PoolClient, event: {
  tenantId: string;
  actorId: string | null;
  source: string;
  entityType: string;
  entityId?: string | null;
  operation: "create" | "update" | "delete" | "import_commit" | "pack_install" | "pack_upgrade" | "approve" | "export" | "publish" | "role_change";
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  jobId?: string | null;
  note?: string | null;
}): Promise<void> {
  const before = event.before ?? null;
  const after = event.after ?? null;
  const delta = before && after ? diffFields(before, after) : null;
  await client.query(
    `INSERT INTO audit_events
      (tenant_id, actor_id, source, entity_type, entity_id, operation, before, after, delta, job_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11)`,
    [
      event.tenantId,
      event.actorId,
      event.source,
      event.entityType,
      event.entityId ?? null,
      event.operation,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      delta ? JSON.stringify(delta) : null,
      event.jobId ?? null,
      event.note ?? null,
    ],
  );
}
