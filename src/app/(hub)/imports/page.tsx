import Link from "next/link";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";

export default async function ImportsPage() {
  const hub = await requireHub();
  const rows = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const result = await client.query<{ id: string; file_name: string; status: string; created_at: string; summary: { errorCount?: number; creates?: number } }>(
      `SELECT id, file_name, status, created_at::text, summary FROM import_jobs WHERE catalog_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [hub.catalogId],
    );
    return result.rows;
  });
  return (
    <>
      <div className="top">
        <div>
          <h1>Imports</h1>
          <p className="lede">Files stay staged until you confirm the mapping and commit. A repeated commit of the same job does not duplicate SKUs.</p>
        </div>
        <Link className="btn" href="/imports/new">Upload</Link>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>File</th><th>Status</th><th>Creates</th><th>Errors</th><th>When</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5}>No imports yet.</td></tr> : rows.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/imports/${row.id}`}>{row.file_name}</Link></td>
                <td>{row.status}</td>
                <td>{row.summary?.creates ?? "—"}</td>
                <td>{row.summary?.errorCount ?? "—"}</td>
                <td className="missing">{new Date(row.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
