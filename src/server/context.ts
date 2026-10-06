import { redirect } from "next/navigation";
import type { Role } from "@/domain/types";
import { actorById } from "./identity";
import { readTenantCookie, readUserId } from "./session";

export type Membership = { tenantId: string; tenantName: string; slug: string; role: Role; catalogId: string; catalogName: string };
export type HubContext = {
  user: { id: string; email: string; name: string };
  tenantId: string;
  tenantName: string;
  slug: string;
  role: Role;
  catalogId: string;
  catalogName: string;
  storageCapBytes: number;
  storageUsedBytes: number;
  memberships: Membership[];
};

type MembershipRow = Membership & { storageCapBytes: number; storageUsedBytes: number };

export async function loadMemberships(userId: string): Promise<MembershipRow[]> {
  const { getAppPool } = await import("./db");
  const result = await getAppPool().query<{
    tenant_id: string; tenant_name: string; slug: string; role: Role; catalog_id: string; catalog_name: string;
    storage_cap_bytes: string; storage_used_bytes: string;
  }>(`SELECT * FROM app_memberships($1)`, [userId]);
  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    slug: row.slug,
    role: row.role,
    catalogId: row.catalog_id,
    catalogName: row.catalog_name,
    storageCapBytes: Number(row.storage_cap_bytes),
    storageUsedBytes: Number(row.storage_used_bytes),
  }));
}

export async function requireHub(): Promise<HubContext> {
  const userId = await readUserId();
  if (!userId) redirect("/login");
  const user = await actorById(userId);
  if (!user) redirect("/login");
  const memberships = await loadMemberships(userId);
  if (memberships.length === 0) redirect("/register?error=Create+a+brand+to+continue");
  const preferred = await readTenantCookie();
  const current = memberships.find((item) => item.tenantId === preferred) ?? memberships[0];
  return toHub(user, current, memberships);
}

export async function requireApiHub(): Promise<HubContext> {
  const userId = await readUserId();
  if (!userId) throw new Error("Sign in required.");
  const user = await actorById(userId);
  if (!user) throw new Error("Sign in required.");
  const memberships = await loadMemberships(userId);
  const preferred = await readTenantCookie();
  const current = memberships.find((item) => item.tenantId === preferred) ?? memberships[0];
  if (!current) throw new Error("No brand membership.");
  return toHub(user, current, memberships);
}

function toHub(user: { id: string; email: string; name: string }, current: MembershipRow, memberships: MembershipRow[]): HubContext {
  return {
    user,
    tenantId: current.tenantId,
    tenantName: current.tenantName,
    slug: current.slug,
    role: current.role,
    catalogId: current.catalogId,
    catalogName: current.catalogName,
    storageCapBytes: current.storageCapBytes,
    storageUsedBytes: current.storageUsedBytes,
    memberships,
  };
}
