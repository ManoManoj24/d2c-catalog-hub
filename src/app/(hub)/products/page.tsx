import Link from "next/link";
import { listSkus } from "@/server/catalog";
import { can } from "@/domain/authz";
import { requireHub } from "@/server/context";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; ready?: string; page?: string; error?: string }> }) {
  const hub = await requireHub();
  const params = await searchParams;
  const page = Number(params.page ?? "1");
  const data = await listSkus(hub.tenantId, hub.user.id, hub.catalogId, {
    q: params.q, status: params.status, ready: params.ready, page,
  });
  const writable = can(hub.role, "catalog.write") || can(hub.role, "catalog.status");
  return (
    <>
      <div className="top">
        <div>
          <h1>Products</h1>
          <p className="lede">Sellable size SKUs. Completeness is the pack’s required fields. Channel ready means the generic marketplace file can take the row and the main image checked out.</p>
        </div>
      </div>
      {params.error ? <p className="banner error">{params.error}</p> : null}
      <form className="filters" method="get">
        <label>Search<input name="q" defaultValue={params.q ?? ""} placeholder="SKU, style, name" /></label>
        <label>Status
          <select name="status" defaultValue={params.status ?? ""}>
            <option value="">Any</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>Channel
          <select name="ready" defaultValue={params.ready ?? ""}>
            <option value="">Any</option>
            <option value="yes">Ready</option>
            <option value="no">Blocked</option>
          </select>
        </label>
        <button className="btn secondary" type="submit">Filter</button>
      </form>
      <form action="/api/products/bulk" method="post">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th></th><th>SKU</th><th>Style</th><th>Color</th><th>Size</th><th>Status</th><th>Completeness</th><th>Channel</th><th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={9}>No SKUs yet. <Link href="/imports/new">Import a file</Link>.</td></tr>
              ) : data.rows.map((row) => (
                <tr key={row.id}>
                  <td>{writable ? <input type="checkbox" name="id" value={row.id} aria-label={`Select ${row.sku}`} /> : null}</td>
                  <td><Link href={`/products/${row.productId}`}>{row.sku}</Link></td>
                  <td>{row.styleCode}<div className="missing">{row.name}</div></td>
                  <td>{row.colorName}</td>
                  <td>{row.size}</td>
                  <td><span className="tag">{row.status}</span></td>
                  <td>
                    {row.quality.completenessPct ?? 0}%
                    <div className="missing">{(row.quality.missing ?? []).slice(0, 4).join(", ") || "Required fields present"}</div>
                  </td>
                  <td>
                    {row.quality.channelReady ? <span className="tag good">Ready</span> : <span className="tag bad">Blocked</span>}
                    {(row.quality.warningCount ?? 0) > 0 ? <div className="missing">{row.quality.warningCount} warning(s)</div> : null}
                  </td>
                  <td className="missing">{new Date(row.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {writable ? (
          <div className="row-actions" style={{ marginTop: 12 }}>
            <label>Set status
              <select name="status" defaultValue="approved">
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <button className="btn" type="submit">Apply to selected</button>
          </div>
        ) : null}
      </form>
      <div className="pager">
        {page > 1 ? <Link href={`/products?page=${page - 1}`}>Previous</Link> : null}
        <span className="help">{data.total} SKUs</span>
        {page * 50 < data.total ? <Link href={`/products?page=${page + 1}`}>Next</Link> : null}
      </div>
    </>
  );
}
