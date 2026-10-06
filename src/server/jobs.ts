import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { checkImageUrl, type MediaCheck } from "@/domain/media/check";
import { withTenant } from "./db";
import { getAppPool } from "./db";
import { commitImport, inspectImport, refreshMediaQuality, validateImport } from "./importer";
import { publishChannelFile } from "./publisher";
import { batchSize } from "./env";

export const workerId = `web-${process.pid}`;

type ClaimedJob = {
  id: string;
  tenant_id: string;
  type: string;
  input: { importJobId?: string; mediaIds?: string[]; catalogId?: string };
  attempts: number;
  max_attempts: number;
  created_by: string | null;
};

export async function enqueueJob(client: PoolClient, job: {
  tenantId: string;
  type: string;
  input: Record<string, unknown>;
  createdBy: string;
  idempotencyKey?: string;
}): Promise<void> {
  await client.query(
    `INSERT INTO jobs (tenant_id, type, status, input, idempotency_key, created_by)
     VALUES ($1,$2,'queued',$3::jsonb,$4,$5)
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    [job.tenantId, job.type, JSON.stringify(job.input), job.idempotencyKey ?? null, job.createdBy],
  );
}

async function claim(): Promise<ClaimedJob | null> {
  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ claim_next_job: ClaimedJob | null }>(`SELECT claim_next_job($1) AS claim_next_job`, [workerId]);
    await client.query("COMMIT");
    return result.rows[0]?.claim_next_job ?? null;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

async function finish(job: ClaimedJob, status: "completed" | "retry" | "dead", error?: string): Promise<void> {
  const client = await getAppPool().connect();
  try {
    const next = status === "retry" && job.attempts >= job.max_attempts ? "dead" : status;
    await client.query(`SELECT finish_job($1,$2,$3::jsonb,$4,$5)`, [job.id, next, null, error ?? null, job.attempts * 2]);
  } finally {
    client.release();
  }
}

async function runMediaCheck(tenantId: string, userId: string, mediaIds: string[]) {
  const size = batchSize();
  for (let offset = 0; offset < mediaIds.length; offset += size) {
    const slice = mediaIds.slice(offset, offset + size);
    const rows = await withTenant(tenantId, userId, async (client) => {
      const result = await client.query<{ id: string; source_url: string | null; color_group_id: string | null }>(
        `SELECT id, source_url, color_group_id FROM media_references WHERE id = ANY($1::uuid[])`,
        [slice],
      );
      return result.rows;
    });
    const checks: { row: (typeof rows)[number]; outcome: MediaCheck }[] = [];
    for (const row of rows) {
      const outcome = row.source_url ? await checkImageUrl(row.source_url) : { ok: false, httpStatus: null, contentType: null, checkedAt: new Date().toISOString(), detail: "Missing URL" };
      checks.push({ row, outcome });
    }
    await withTenant(tenantId, userId, async (client) => {
      for (const item of checks) {
        await client.query(
          `UPDATE media_references
           SET check_result = $2, http_status = $3, content_type = $4, check_detail = $5, checked_at = $6
           WHERE id = $1`,
          [item.row.id, item.outcome.ok ? "ok" : "failed", item.outcome.httpStatus, item.outcome.contentType, item.outcome.detail, item.outcome.checkedAt],
        );
      }
      const colorIds = [...new Set(rows.map((row) => row.color_group_id).filter((id): id is string => Boolean(id)))];
      const catalog = await client.query<{ catalog_id: string }>(`SELECT catalog_id FROM media_references WHERE id = $1`, [slice[0]]);
      if (catalog.rows[0]) await refreshMediaQuality(client, catalog.rows[0].catalog_id, colorIds);
    });
  }
}

export async function processNextJob(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const userId = job.created_by;
  if (!userId) {
    await finish(job, "dead", "Job has no actor.");
    return true;
  }
  try {
    if (job.type === "import.inspect" && job.input.importJobId) {
      await inspectImport(job.tenant_id, userId, job.input.importJobId);
    } else if (job.type === "import.validate" && job.input.importJobId) {
      await validateImport(job.tenant_id, userId, job.input.importJobId);
    } else if (job.type === "import.commit" && job.input.importJobId) {
      const result = await commitImport(job.tenant_id, userId, job.input.importJobId);
      if (result.mediaIds.length) {
        await withTenant(job.tenant_id, userId, (client) => enqueueJob(client, {
          tenantId: job.tenant_id,
          type: "media.check",
          input: { mediaIds: result.mediaIds },
          createdBy: userId,
          idempotencyKey: `media-${job.input.importJobId}`,
        }));
      }
    } else if (job.type === "media.check") {
      await runMediaCheck(job.tenant_id, userId, job.input.mediaIds ?? []);
    } else if (job.type === "export.generate" && job.input.catalogId) {
      await publishChannelFile(job.tenant_id, userId, job.input.catalogId);
    } else {
      throw new Error(`Unknown job type ${job.type}`);
    }
    await finish(job, "completed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Job failed.";
    await finish(job, "retry", message);
    if (job.input.importJobId && job.attempts >= job.max_attempts) {
      await withTenant(job.tenant_id, userId, (client) => client.query(
        `UPDATE import_jobs SET status = 'failed', error_summary = $2, updated_at = now() WHERE id = $1 AND status NOT IN ('completed', 'failed')`,
        [job.input.importJobId, message],
      ));
    }
  }
  return true;
}

let pumping = false;

export function kickWorker(): void {
  if (process.env.JOB_MODE === "external" || pumping) return;
  pumping = true;
  setImmediate(async () => {
    try {
      for (let n = 0; n < 25; n += 1) {
        const worked = await processNextJob();
        if (!worked) break;
      }
    } catch (error) {
      console.error("queue kick failed", error);
    } finally {
      pumping = false;
    }
  });
}

export function newIdempotencyKey(): string {
  return randomUUID();
}
