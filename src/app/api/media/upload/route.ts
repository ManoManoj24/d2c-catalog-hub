import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { assertCan } from "@/domain/authz";
import { loadKidswearPack } from "@/domain/pack/load";
import { appOrigin } from "@/server/env";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { signObject } from "@/server/session";
import { objectStore } from "@/server/object-store";
import { refreshMediaQuality } from "@/server/importer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hub = await requireApiHub();
  assertCan(hub.role, "catalog.write");
  const form = await request.formData();
  const file = form.get("file");
  const colorGroupId = String(form.get("colorGroupId") ?? "");
  const productId = String(form.get("productId") ?? "");
  const role = form.get("role") === "alternate" ? "alternate" : "main";
  if (!(file instanceof File)) return NextResponse.redirect(new URL(`/products/${productId}?error=Choose+an+image`, request.url));
  const limits = loadKidswearPack().pack.limits;
  if (file.size > limits.maxUploadBytes) {
    return NextResponse.redirect(new URL(`/products/${productId}?error=Image+exceeds+the+5+MB+limit`, request.url));
  }
  const type = file.type.toLowerCase();
  if (!limits.allowedImageTypes.includes(type)) {
    return NextResponse.redirect(new URL(`/products/${productId}?error=Use+JPEG,+PNG,+or+WebP`, request.url));
  }
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const key = `tenants/${hub.tenantId}/media/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    await withTenant(hub.tenantId, hub.user.id, async (client) => {
      await client.query(`SELECT app_add_storage($1, $2)`, [hub.tenantId, file.size]);
      const owned = await client.query(`SELECT id FROM product_color_groups WHERE id = $1 AND catalog_id = $2`, [colorGroupId, hub.catalogId]);
      if (!owned.rows[0]) throw new Error("Colorway not found.");
      await objectStore().put(key, bytes, type);
      const exp = Date.now() + 1000 * 60 * 60 * 24 * 30;
      const delivery = `${appOrigin()}/api/media/public?key=${encodeURIComponent(key)}&exp=${exp}&sig=${signObject(key, exp)}`;
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM media_references WHERE color_group_id = $1 AND role = $2 AND scope = 'colorway'`,
        [colorGroupId, role],
      );
      if (existing.rows[0]) {
        await client.query(
          `UPDATE media_references SET source = 'upload', object_key = $2, delivery_url = $3, source_url = $3, content_type = $4, bytes = $5, check_result = 'ok', checked_at = now(), http_status = 200 WHERE id = $1`,
          [existing.rows[0].id, key, delivery, type, file.size],
        );
      } else {
        await client.query(
          `INSERT INTO media_references
            (tenant_id, catalog_id, scope, product_id, color_group_id, role, source, object_key, source_url, delivery_url, content_type, bytes, check_result, checked_at, http_status)
           VALUES ($1,$2,'colorway',$3,$4,$5,'upload',$6,$7,$7,$8,$9,'ok',now(),200)`,
          [hub.tenantId, hub.catalogId, productId, colorGroupId, role, key, delivery, type, file.size],
        );
      }
      await refreshMediaQuality(client, hub.catalogId, [colorGroupId]);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.redirect(new URL(`/products/${productId}?error=${encodeURIComponent(message)}`, request.url));
  }
  return NextResponse.redirect(new URL(`/products/${productId}?saved=1`, request.url));
}
