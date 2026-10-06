import bcrypt from "bcryptjs";
import { getAppPool } from "./db";

export type Actor = { id: string; email: string; name: string };

export async function registerUser(email: string, name: string, password: string): Promise<Actor> {
  const hash = await bcrypt.hash(password, 10);
  const result = await getAppPool().query<{ app_insert_user: string }>(
    `SELECT app_insert_user($1, $2, $3)`,
    [email, name, hash],
  );
  return { id: result.rows[0].app_insert_user, email: email.toLowerCase(), name };
}

export async function authenticate(email: string, password: string): Promise<Actor | null> {
  const result = await getAppPool().query<{ id: string; email: string; name: string; password_hash: string }>(
    `SELECT * FROM app_user_by_email($1)`,
    [email],
  );
  const user = result.rows[0];
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return { id: user.id, email: user.email, name: user.name };
}

export async function actorById(id: string): Promise<Actor | null> {
  const result = await getAppPool().query<Actor>(`SELECT * FROM app_user_by_id($1)`, [id]);
  return result.rows[0] ?? null;
}

export async function bootstrapTenant(userId: string, brandName: string, slug: string): Promise<{ tenantId: string; catalogId: string }> {
  const result = await getAppPool().query<{ tenant_id: string; catalog_id: string }>(
    `SELECT * FROM app_bootstrap_tenant($1, $2, $3)`,
    [userId, brandName, slug],
  );
  return { tenantId: result.rows[0].tenant_id, catalogId: result.rows[0].catalog_id };
}
