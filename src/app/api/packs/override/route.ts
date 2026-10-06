import { NextResponse } from "next/server";
import { assertCan } from "@/domain/authz";
import type { TenantOverride } from "@/domain/types";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { installKidswearPack } from "@/server/packs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hub = await requireApiHub();
  assertCan(hub.role, "schema.write");
  const form = await request.formData();
  const key = String(form.get("key") ?? "");
  const label = String(form.get("label") ?? "").trim();
  if (!key || !label) return NextResponse.redirect(new URL("/packs?error=Label+is+required", request.url));
  try {
    await withTenant(hub.tenantId, hub.user.id, async (client) => {
      const current = await client.query<{ overrides: TenantOverride[] }>(
        `SELECT overrides FROM pack_installations WHERE catalog_id = $1 AND pack_key = 'kidswear'`,
        [hub.catalogId],
      );
      const overrides = [...(current.rows[0]?.overrides ?? []).filter((item) => item.key !== key), { key, label }];
      const result = await installKidswearPack(client, {
        tenantId: hub.tenantId,
        catalogId: hub.catalogId,
        userId: hub.user.id,
        acceptPackChanges: true,
        overrides,
      });
      if (!result.applied) throw new Error(result.conflicts.map((conflict) => conflict.message).join(" "));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Override failed";
    return NextResponse.redirect(new URL(`/packs?error=${encodeURIComponent(message)}`, request.url));
  }
  return NextResponse.redirect(new URL("/packs?saved=1", request.url));
}
