import Link from "next/link";
import { RefreshWhile } from "@/app/components/refresh";
import { can } from "@/domain/authz";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const hub = await requireHub();
  const params = await searchParams;
  const data = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const exports = await client.query<{ id: string; status: string; created_at: string; summary: { childRows?: number; blocked?: number }; receipt: { csvKey?: string; xlsxKey?: string } }>(
      `SELECT id, status, created_at::text, summary, receipt FROM export_jobs WHERE catalog_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [hub.catalogId],
    );
    const running = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM jobs WHERE tenant_id = $1 AND type = 'export.generate' AND status IN ('queued', 'running')`,
      [hub.tenantId],
    );
    const ready = await client.query<{ ready: string; blocked: string }>(
      `SELECT
         count(*) FILTER (WHERE quality->>'channelReady' = 'true')::text AS ready,
         count(*) FILTER (WHERE COALESCE(quality->>'channelReady','false') <> 'true')::text AS blocked
       FROM variants WHERE catalog_id = $1`,
      [hub.catalogId],
    );
    return { exports: exports.rows, running: Number(running.rows[0]?.n ?? 0), ready: ready.rows[0] };
  });
  return (
    <>
      <div className="top">
        <div>
          <h1>Channels</h1>
          <p className="lede">Generic marketplace file. Parent rows come from the style. Child rows are size SKUs. The workbook keeps its instruction sheet and header rows.</p>
        </div>
      </div>
      {params.error ? <p className="banner error">{params.error}</p> : null}
      <RefreshWhile active={data.running > 0} />
      <section className="stats">
        <article className="stat"><b>{data.ready?.ready ?? 0}</b><span>Ready to export</span></article>
        <article className="stat"><b>{data.ready?.blocked ?? 0}</b><span>Blocked SKUs</span></article>
      </section>
      {can(hub.role, "export") ? (
        <form action="/api/exports" method="post" className="card">
          <p>Blocked SKUs stay out of the file. Their reasons stay on the product page.</p>
          <button className="btn" type="submit">Build channel files</button>
        </form>
      ) : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Child rows</th><th>Blocked</th><th>Files</th></tr></thead>
          <tbody>
            {data.exports.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.summary?.childRows ?? "—"}</td>
                <td>{row.summary?.blocked ?? "—"}</td>
                <td>
                  {row.receipt?.csvKey ? <Link href={`/api/exports/${row.id}?format=csv`}>CSV</Link> : null}
                  {" "}
                  {row.receipt?.xlsxKey ? <Link href={`/api/exports/${row.id}?format=xlsx`}>XLSX</Link> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
