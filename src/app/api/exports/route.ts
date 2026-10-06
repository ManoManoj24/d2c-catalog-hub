import { NextResponse } from "next/server";
import { assertCan } from "@/domain/authz";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { enqueueJob, kickWorker } from "@/server/jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hub = await requireApiHub();
  assertCan(hub.role, "export");
  await withTenant(hub.tenantId, hub.user.id, (client) => enqueueJob(client, {
    tenantId: hub.tenantId,
    type: "export.generate",
    input: { catalogId: hub.catalogId },
    createdBy: hub.user.id,
    idempotencyKey: `export-${hub.catalogId}-${Date.now()}`,
  }));
  kickWorker();
  return NextResponse.redirect(new URL("/channels", request.url));
}
