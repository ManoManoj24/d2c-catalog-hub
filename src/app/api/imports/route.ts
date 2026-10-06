import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertCan } from "@/domain/authz";
import { loadKidswearPack } from "@/domain/pack/load";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { enqueueJob, kickWorker, newIdempotencyKey } from "@/server/jobs";
import { objectStore } from "@/server/object-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hub = await requireApiHub();
  assertCan(hub.role, "catalog.write");
  const form = await request.formData();
  const file = form.get("file");
  const mode = form.get("mode") === "partial" ? "partial" : "atomic";
  if (!(file instanceof File)) return NextResponse.redirect(new URL("/imports/new?error=Choose+a+file", request.url));
  const limits = loadKidswearPack().pack.limits;
  if (file.size > limits.maxImportBytes) {
    return NextResponse.redirect(new URL("/imports/new?error=File+exceeds+the+20+MB+limit", request.url));
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith(".csv") && !name.endsWith(".xlsx")) {
    return NextResponse.redirect(new URL("/imports/new?error=Upload+a+CSV+or+XLSX+file", request.url));
  }
  const id = randomUUID();
  const key = `tenants/${hub.tenantId}/imports/${id}/${name.endsWith(".csv") ? "source.csv" : "source.xlsx"}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await objectStore().put(key, bytes, file.type || "application/octet-stream");
  await withTenant(hub.tenantId, hub.user.id, async (client) => {
    await client.query(
      `INSERT INTO import_jobs (id, tenant_id, catalog_id, status, file_object_key, file_name, file_size, mode, idempotency_key, created_by)
       VALUES ($1,$2,$3,'uploaded',$4,$5,$6,$7,$8,$9)`,
      [id, hub.tenantId, hub.catalogId, key, file.name, file.size, mode, newIdempotencyKey(), hub.user.id],
    );
    await enqueueJob(client, { tenantId: hub.tenantId, type: "import.inspect", input: { importJobId: id }, createdBy: hub.user.id });
  });
  kickWorker();
  return NextResponse.redirect(new URL(`/imports/${id}`, request.url));
}
