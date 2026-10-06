import { NextResponse } from "next/server";
import { assertCan } from "@/domain/authz";
import { coerceAttribute } from "@/domain/quality/fields";
import type { FieldBag, Issue } from "@/domain/types";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { enqueueJob, kickWorker } from "@/server/jobs";
import { loadSchema } from "@/server/schema";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const hub = await requireApiHub();
  assertCan(hub.role, "catalog.write");
  const { id } = await context.params;
  const form = await request.formData();
  const attributeKey = String(form.get("attributeKey") ?? "");
  const value = String(form.get("value") ?? "");
  await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const schema = await loadSchema(client, hub.catalogId);
    const def = schema.definitions.find((item) => item.key === attributeKey);
    if (!def) throw new Error("Unknown attribute.");
    const coerced = coerceAttribute(def, value);
    const rows = await client.query<{ id: string; values: FieldBag; issues: Issue[] }>(
      `SELECT id, values, issues FROM import_rows WHERE import_job_id = $1`,
      [id],
    );
    for (const row of rows.rows) {
      const hit = (row.issues ?? []).some((issue) => issue.attributeKey === attributeKey && issue.severity === "error");
      if (!hit) continue;
      await client.query(`UPDATE import_rows SET values = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify({ ...row.values, [attributeKey]: coerced })]);
    }
    await client.query(`UPDATE import_jobs SET progress = '{"phase":"revalidate_staged"}'::jsonb, updated_at = now() WHERE id = $1`, [id]);
    await enqueueJob(client, {
      tenantId: hub.tenantId,
      type: "import.validate",
      input: { importJobId: id },
      createdBy: hub.user.id,
      idempotencyKey: `validate-${id}-${Date.now()}`,
    });
  });
  kickWorker();
  return NextResponse.redirect(new URL(`/imports/${id}`, request.url));
}
