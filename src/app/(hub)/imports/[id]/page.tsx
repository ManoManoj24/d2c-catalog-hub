import Link from "next/link";
import { RefreshWhile } from "@/app/components/refresh";
import type { AttributeDefinition, Issue, PlanSummary } from "@/domain/types";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";

const ACTIVE = new Set(["uploaded", "inspecting", "staging", "validating", "committing"]);

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const hub = await requireHub();
  const { id } = await params;
  const data = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const job = await client.query<{
      id: string; status: string; file_name: string; headers: string[]; suggestions: { column: string; attributeKey: string | null; confidence: string }[];
      mapping: Record<string, string>; summary: PlanSummary; error_summary: string | null; progress: { processed?: number; total?: number; phase?: string }; mode: string;
    }>(`SELECT id, status, file_name, headers, suggestions, mapping, summary, error_summary, progress, mode FROM import_jobs WHERE id = $1`, [id]);
    const defs = await client.query<{ key: string; label: string }>(`SELECT key, label FROM attribute_definitions WHERE catalog_id = $1 ORDER BY sort_order`, [hub.catalogId]);
    const rows = await client.query<{ row_number: number; sku: string | null; action: string; issues: Issue[] }>(
      `SELECT row_number, sku, action, issues FROM import_rows WHERE import_job_id = $1 ORDER BY row_number LIMIT 100`,
      [id],
    );
    return { job: job.rows[0], defs: defs.rows, rows: rows.rows };
  });
  if (!data.job) return <p>Import not found.</p>;
  const job = data.job;
  const summary = job.summary ?? ({} as PlanSummary);
  return (
    <>
      <div className="top">
        <div>
          <h1>{job.file_name}</h1>
          <p className="lede">Status: {job.status.replaceAll("_", " ")}{job.progress?.total ? ` · ${job.progress.processed ?? 0}/${job.progress.total}` : ""}</p>
        </div>
        <Link className="btn secondary" href="/imports">All imports</Link>
      </div>
      <RefreshWhile active={ACTIVE.has(job.status)} />
      {job.error_summary ? <p className="banner error">{job.error_summary}</p> : null}
      {job.status === "mapping_required" ? (
        <form className="card" action={`/api/imports/${id}/mapping`} method="post">
          <h2>Confirm column mapping</h2>
          <p className="help">Suggestions are not applied until you confirm them.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Column</th><th>Map to</th><th>Match</th></tr></thead>
              <tbody>
                {(job.suggestions ?? []).map((suggestion) => (
                  <tr key={suggestion.column}>
                    <td>{suggestion.column}<input type="hidden" name="column" value={suggestion.column} /></td>
                    <td>
                      <select name="attribute" defaultValue={suggestion.attributeKey ?? ""}>
                        <option value="">Ignore</option>
                        {data.defs.map((def: Pick<AttributeDefinition, "key" | "label">) => (
                          <option key={def.key} value={def.key}>{def.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="missing">{suggestion.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn" type="submit">Validate staged rows</button>
        </form>
      ) : null}
      {job.status === "review_required" || job.status === "completed" ? (
        <section className="stats">
          <article className="stat"><b>{summary.creates ?? 0}</b><span>Creates</span></article>
          <article className="stat"><b>{summary.updates ?? 0}</b><span>Updates</span></article>
          <article className="stat"><b>{summary.unchanged ?? 0}</b><span>Unchanged</span></article>
          <article className="stat"><b>{summary.errorCount ?? 0}</b><span>Errors</span></article>
        </section>
      ) : null}
      {job.status === "review_required" ? (
        <>
          {summary.blocked ? <p className="banner error">Atomic mode is blocking commit until every error is fixed or you switch the import to partial mode by re-uploading.</p> : null}
          <form className="card stack" action={`/api/imports/${id}/fix`} method="post">
            <h2>Bulk fix</h2>
            <label>Attribute
              <select name="attributeKey">
                {data.defs.map((def) => <option key={def.key} value={def.key}>{def.label}</option>)}
              </select>
            </label>
            <label>New value<input name="value" required /></label>
            <button className="btn secondary" type="submit">Apply to rows that fail this field</button>
          </form>
          <form action={`/api/imports/${id}/commit`} method="post">
            <button className="btn" type="submit" disabled={Boolean(summary.blocked)}>Commit to catalog</button>
          </form>
        </>
      ) : null}
      {job.status === "completed" ? <p className="banner ok">Committed. <Link href="/products">Open the product grid</Link>.</p> : null}
      {data.rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Row</th><th>SKU</th><th>Action</th><th>Issues</th></tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.row_number}>
                  <td>{row.row_number}</td>
                  <td>{row.sku}</td>
                  <td>{row.action}</td>
                  <td>{(row.issues ?? []).map((issue) => (
                    <div key={`${issue.rule}-${issue.attributeKey}`}>{issue.severity}: {issue.message} {issue.proposedFix ? <span className="missing">Fix: {issue.proposedFix}</span> : null}</div>
                  ))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p><a href={`/api/imports/${id}/issues`}>Download error report</a></p>
    </>
  );
}
