import { NextResponse } from "next/server";
import { assertCan, can } from "@/domain/authz";
import { saveProduct } from "@/server/catalog";
import { requireApiHub } from "@/server/context";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const hub = await requireApiHub();
  const { id } = await context.params;
  if (!can(hub.role, "catalog.write") && !can(hub.role, "catalog.status")) {
    assertCan(hub.role, "catalog.write");
  }
  const form = await request.formData();
  try {
    await saveProduct(hub.tenantId, hub.user.id, hub.catalogId, id, form);
    return NextResponse.redirect(new URL(`/products/${id}?saved=1`, request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save";
    return NextResponse.redirect(new URL(`/products/${id}?error=${encodeURIComponent(message)}`, request.url));
  }
}
