import { Pool, type PoolClient } from "pg";
import { adminDatabaseUrl, appDatabaseUrl } from "./env";

const globalPools = globalThis as unknown as { appPool?: Pool; adminPool?: Pool };

export function getAppPool(): Pool {
  if (!globalPools.appPool) {
    globalPools.appPool = new Pool({ connectionString: appDatabaseUrl(), max: 8 });
  }
  return globalPools.appPool;
}

export function getAdminPool(): Pool {
  if (!globalPools.adminPool) {
    globalPools.adminPool = new Pool({ connectionString: adminDatabaseUrl(), max: 2 });
  }
  return globalPools.adminPool;
}

export async function withTenant<T>(tenantId: string, userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already lost */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already lost */
    }
    throw error;
  } finally {
    client.release();
  }
}
