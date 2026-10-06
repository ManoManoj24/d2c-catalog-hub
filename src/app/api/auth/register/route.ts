import { NextResponse } from "next/server";
import { installKidswearPack } from "@/server/packs";
import { bootstrapTenant, registerUser } from "@/server/identity";
import { withTenant } from "@/server/db";
import { writeSession, writeTenantCookie } from "@/server/session";

export const runtime = "nodejs";

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const brand = String(form.get("brand") ?? "").trim();
  if (!name || !email || password.length < 8 || !brand) {
    return NextResponse.redirect(new URL("/register?error=Name,+email,+brand,+and+an+8+character+password+are+required", request.url));
  }
  try {
    const user = await registerUser(email, name, password);
    const tenant = await bootstrapTenant(user.id, brand, slugify(brand));
    await withTenant(tenant.tenantId, user.id, (client) => installKidswearPack(client, {
      tenantId: tenant.tenantId,
      catalogId: tenant.catalogId,
      userId: user.id,
      acceptPackChanges: true,
    }));
    await writeSession(user.id);
    await writeTenantCookie(tenant.tenantId);
    return NextResponse.redirect(new URL("/", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the workspace";
    return NextResponse.redirect(new URL(`/register?error=${encodeURIComponent(message)}`, request.url));
  }
}
