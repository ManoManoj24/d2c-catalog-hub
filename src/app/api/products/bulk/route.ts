import { NextResponse } from "next/server";
import { can } from "@/domain/authz";
import type { ProductStatus } from "@/domain/types";
import { bulkStatus } from "@/server/catalog";
import { requireApiHub } from "@/server/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hub = await requireApiHub();
  if (!can(hub.role, "catalog.write") && !can(hub.role, "catalog.status")) {
    return NextResponse.redirect(new URL("/products?error=You+cannot+edit+the+catalog", request.url));
  }
  const form = await request.formData();
  const ids = form.getAll("id").map(String);
  const status = String(form.get("status") ?? "draft") as ProductStatus;
  if (!["draft", "approved", "archived"].includes(status)) {
    return NextResponse.redirect(new URL("/products?error=Unknown+status", request.url));
  }
  await bulkStatus(hub.tenantId, hub.user.id, hub.catalogId, ids, status);
  return NextResponse.redirect(new URL("/products", request.url));
}
