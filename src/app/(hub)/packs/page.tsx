import { can } from "@/domain/authz";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { loadSchema } from "@/server/schema";

export default async function PackPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const hub = await requireHub();
  const params = await searchParams;
  const data = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const schema = await loadSchema(client, hub.catalogId);
    const install = await client.query<{ pack_version: number; installed_at: string }>(
      `SELECT pack_version, installed_at::text FROM pack_installations WHERE catalog_id = $1 AND pack_key = 'kidswear'`,
      [hub.catalogId],
    );
    return { schema, install: install.rows[0] };
  });
  const groups = [...new Set(data.schema.definitions.map((def) => def.groupKey))];
  return (
    <>
      <div className="top">
        <div>
          <h1>Kidswear Pack v{data.install?.pack_version ?? data.schema.packVersion}</h1>
          <p className="lede">Configuration, not a code fork. Tenant label overrides win until an admin accepts a pack change. Tax rates are versioned schedule data.</p>
        </div>
      </div>
      {params.error ? <p className="banner error">{params.error}</p> : null}
      {params.saved ? <p className="banner ok">Label override saved.</p> : null}
      <section className="card">
        <h2>Active tax schedule</h2>
        <p><strong>{data.schema.taxSchedule.id}</strong> · {data.schema.taxSchedule.reviewStatus} · effective {data.schema.taxSchedule.effectiveFrom ?? "n/a"}</p>
        <p className="help">{data.schema.taxSchedule.disclaimer}</p>
        <ul>
          {data.schema.taxSchedule.hsn.map((entry) => (
            <li key={entry.code}>{entry.code} — {entry.label}</li>
          ))}
        </ul>
      </section>
      {groups.map((group) => (
        <section className="group" key={group}>
          <h2>{data.schema.definitions.find((def) => def.groupKey === group)?.groupLabel}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Field</th><th>Scope</th><th>Type</th><th>Required</th></tr></thead>
              <tbody>
                {data.schema.definitions.filter((def) => def.groupKey === group).map((def) => (
                  <tr key={def.key}>
                    <td>{def.label}<div className="missing">{def.key}</div></td>
                    <td>{def.scope}</td>
                    <td>{def.dataType}</td>
                    <td>{def.required ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {can(hub.role, "schema.write") ? (
        <form className="card stack" action="/api/packs/override" method="post">
          <h2>Rename a label</h2>
          <p className="help">The stable key does not change. A later pack upgrade will not overwrite this label.</p>
          <label>Field
            <select name="key">{data.schema.definitions.map((def) => <option key={def.key} value={def.key}>{def.label}</option>)}</select>
          </label>
          <label>New label<input name="label" required /></label>
          <button className="btn" type="submit">Save override</button>
        </form>
      ) : null}
    </>
  );
}
