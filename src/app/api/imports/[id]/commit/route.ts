import { NextResponse } from "next/server";
import { assertCan } from "@/domain/authz";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { enqueueJob, kickWorker } from "@/server/jobs";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const hub = await requireApiHub();
  assertCan(hub.role, "catalog.write");
  const { id } = await context.params;
  await withTenant(hub.tenantId, hub.user.id, async (client) => {
    await client.query(`UPDATE import_jobs SET status = 'committing', updated_at = now() WHERE id = $1 AND catalog_id = $2 AND status = 'review_required'`, [id, hub.catalogId]);
    await enqueueJob(client, {
      tenantId: hub.tenantId,
      type: "import.commit",
      input: { importJobId: id },
      createdBy: hub.user.id,
      idempotencyKey: `commit-${id}-${Date.now()}`,
    });
  });
  kickWorker();
  return NextResponse.redirect(new URL(`/imports/${id}`, request.url));
}
