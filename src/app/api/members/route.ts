import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { assertCan } from "@/domain/authz";
import type { Role } from "@/domain/types";
import { requireApiHub } from "@/server/context";
import { getAppPool, withTenant } from "@/server/db";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const hub = await requireApiHub();
  assertCan(hub.role, "member.manage");
  const form = await request.formData();
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const role = String(form.get("role") ?? "editor") as Role;
  if (!["admin", "editor", "reviewer", "viewer"].includes(role)) {
    return NextResponse.redirect(new URL("/settings?error=That+role+cannot+be+assigned+here", request.url));
  }
  if (!name || !email || password.length < 8) {
    return NextResponse.redirect(new URL("/settings?error=Name,+email,+and+password+are+required", request.url));
  }
  const pool = getAppPool();
  const existing = await pool.query<{ id: string }>(`SELECT id FROM app_user_by_email($1)`, [email]);
  let userId = existing.rows[0]?.id;
  if (!userId) {
    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query<{ app_insert_user: string }>(`SELECT app_insert_user($1,$2,$3)`, [email, name, hash]);
    userId = inserted.rows[0].app_insert_user;
  }
  try {
    await withTenant(hub.tenantId, hub.user.id, async (client) => {
      await client.query(
        `INSERT INTO memberships (tenant_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [hub.tenantId, userId, role],
      );
      await writeAudit(client, {
        tenantId: hub.tenantId, actorId: hub.user.id, source: "ui", entityType: "membership", entityId: userId,
        operation: "role_change", after: { email, role },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add member";
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(message)}`, request.url));
  }
  return NextResponse.redirect(new URL("/settings?saved=1", request.url));
}
