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
  const form = await request.formData();
  const columns = form.getAll("column").map(String);
  const attributes = form.getAll("attribute").map(String);
  const mapping: Record<string, string | null> = {};
  columns.forEach((column, index) => {
    mapping[column] = attributes[index] || null;
  });
  await withTenant(hub.tenantId, hub.user.id, async (client) => {
    await client.query(
      `UPDATE import_jobs SET mapping = $2::jsonb, status = 'staging', updated_at = now() WHERE id = $1 AND catalog_id = $3`,
      [id, JSON.stringify(mapping), hub.catalogId],
    );
    await enqueueJob(client, { tenantId: hub.tenantId, type: "import.validate", input: { importJobId: id }, createdBy: hub.user.id, idempotencyKey: `validate-${id}-${Date.now()}` });
  });
  kickWorker();
  return NextResponse.redirect(new URL(`/imports/${id}`, request.url));
}
