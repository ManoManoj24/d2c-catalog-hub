import Link from "next/link";
import { dashboard } from "@/server/catalog";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";

export default async function DashboardPage() {
  const hub = await requireHub();
  const data = await dashboard(hub.tenantId, hub.user.id, hub.catalogId);
  const schedule = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const result = await client.query<{ schedule_key: string; definition: { reviewStatus: string; disclaimer: string } }>(
      `SELECT schedule_key, definition FROM tax_schedules WHERE catalog_id = $1 AND status = 'active_candidate' LIMIT 1`,
      [hub.catalogId],
    );
    return result.rows[0] ?? null;
  });
  const counts = data.counts ?? { styles: "0", skus: "0", ready: "0", imports: "0" };
  return (
    <>
      <div className="top">
        <div>
          <h1>{hub.tenantName}</h1>
          <p className="lede">Where is the catalog blocked? Start with an import, then clear the errors the pack explains.</p>
        </div>
        <Link className="btn" href="/imports/new">Upload a catalog file</Link>
      </div>
      {schedule ? (
        <div className="banner">
          Tax schedule <strong>{schedule.schedule_key}</strong> is {schedule.definition.reviewStatus}. {schedule.definition.disclaimer}
        </div>
      ) : (
        <div className="banner error">Kidswear pack is not installed. Open Pack setup.</div>
      )}
      <section className="stats">
        <article className="stat"><b>{counts.styles}</b><span>Styles</span></article>
        <article className="stat"><b>{counts.skus}</b><span>Size SKUs</span></article>
        <article className="stat"><b>{counts.ready}</b><span>Channel-ready SKUs</span></article>
        <article className="stat"><b>{counts.imports}</b><span>Open imports</span></article>
      </section>
      <section className="card">
        <h2>Latest import</h2>
        {data.latest ? (
          <p><Link href={`/imports/${data.latest.id}`}>{data.latest.file_name}</Link> · {data.latest.status}</p>
        ) : (
          <p className="help">No file yet. The sample kidswear CSV is in <code>samples/kidswear-catalog.csv</code>.</p>
        )}
      </section>
    </>
  );
}
