import Link from "next/link";
import { can } from "@/domain/authz";
import type { AttributeDefinition, FieldBag, Picklist } from "@/domain/types";
import { requireHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { loadSchema } from "@/server/schema";

function Field({ name, def, value, picklists, disabled }: {
  name: string; def: AttributeDefinition; value: unknown; picklists: Picklist[]; disabled: boolean;
}) {
  const current = value == null ? "" : String(value);
  const list = def.rules.picklistKey ? picklists.find((item) => item.key === def.rules.picklistKey) : undefined;
  return (
    <label>
      {def.label}{def.required ? " *" : ""}
      {list ? (
        <select name={name} defaultValue={current} disabled={disabled}>
          <option value="">Select</option>
          {list.values.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      ) : (
        <input name={name} defaultValue={current} disabled={disabled} />
      )}
      {def.help ? <span className="help">{def.help}</span> : null}
    </label>
  );
}

export default async function ProductPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const hub = await requireHub();
  const { id } = await params;
  const query = await searchParams;
  const writable = can(hub.role, "catalog.write");
  const data = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const schema = await loadSchema(client, hub.catalogId);
    const product = await client.query<{ id: string; style_code: string; name: string; status: string; variation_theme: string; values: FieldBag }>(
      `SELECT id, style_code, name, status, variation_theme, values FROM products WHERE id = $1 AND catalog_id = $2`,
      [id, hub.catalogId],
    );
    const colors = await client.query<{ id: string; color_code: string; color_name: string; values: FieldBag }>(
      `SELECT id, color_code, color_name, values FROM product_color_groups WHERE product_id = $1 ORDER BY color_code`,
      [id],
    );
    const variants = await client.query<{ id: string; sku: string; size: string | null; mrp: string | null; barcode: string | null; values: FieldBag; quality: { completenessPct?: number; missing?: string[]; channelReady?: boolean; channelMessages?: string[] }; color_group_id: string }>(
      `SELECT id, sku, size, mrp::text, barcode, values, quality, color_group_id FROM variants WHERE product_id = $1 ORDER BY sku`,
      [id],
    );
    const media = await client.query<{ color_group_id: string; role: string; source_url: string | null; check_result: string; check_detail: string | null }>(
      `SELECT color_group_id, role, source_url, check_result, check_detail FROM media_references WHERE product_id = $1`,
      [id],
    );
    const history = await client.query<{ operation: string; created_at: string; note: string | null; source: string }>(
      `SELECT operation, created_at::text, note, source FROM audit_events
       WHERE entity_id = $1::text
          OR entity_id IN (SELECT id::text FROM variants WHERE product_id = $1::uuid)
       ORDER BY created_at DESC LIMIT 8`,
      [id],
    );
    return { schema, product: product.rows[0], colors: colors.rows, variants: variants.rows, media: media.rows, history: history.rows };
  });
  if (!data.product) return <p>Style not found.</p>;
  const styleValues: FieldBag = { ...data.product.values, style_name: data.product.name, variation_theme: data.product.variation_theme, style_code: data.product.style_code };
  const groups = [...new Set(data.schema.definitions.filter((def) => def.scope === "style").map((def) => def.groupKey))];
  return (
    <>
      <div className="top">
        <div>
          <h1>{data.product.name}</h1>
          <p className="lede">{data.product.style_code} · {data.product.variation_theme}</p>
        </div>
        <Link className="btn secondary" href="/products">Back to grid</Link>
      </div>
      {query.error ? <p className="banner error">{query.error}</p> : null}
      {query.saved ? <p className="banner ok">Saved. Scores were recalculated from the pack rules.</p> : null}
      <form action={`/api/products/${id}`} method="post">
        <label>Status
          <select name="status" defaultValue={data.product.status} disabled={!writable && !can(hub.role, "catalog.status")}>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        {groups.map((group) => (
          <section className="group" key={group}>
            <h2>{data.schema.definitions.find((def) => def.groupKey === group)?.groupLabel}</h2>
            <div className="fields">
              {data.schema.definitions.filter((def) => def.scope === "style" && def.groupKey === group).map((def) => (
                <Field key={def.key} name={`style.${def.key}`} def={def} value={styleValues[def.key]} picklists={data.schema.picklists} disabled={!writable || def.key === "style_code"} />
              ))}
            </div>
          </section>
        ))}
        {data.colors.map((color) => (
          <section className="group" key={color.id}>
            <h2>{color.color_name} · {color.color_code}</h2>
            <div className="fields">
              {data.schema.definitions.filter((def) => def.scope === "colorway").map((def) => (
                <Field key={def.key} name={`color.${color.id}.${def.key}`} def={def} value={color.values[def.key]} picklists={data.schema.picklists} disabled={!writable} />
              ))}
            </div>
            <ul>
              {data.media.filter((item) => item.color_group_id === color.id).map((item) => (
                <li key={`${item.role}-${item.source_url}`}>{item.role}: {item.check_result} {item.check_detail ? `· ${item.check_detail}` : ""}</li>
              ))}
            </ul>
            {data.variants.filter((variant) => variant.color_group_id === color.id).map((variant) => (
              <article className="card" key={variant.id}>
                <h3>{variant.sku}</h3>
                <p className="help">
                  {variant.quality.completenessPct ?? 0}% complete
                  {(variant.quality.missing ?? []).length ? ` · missing ${variant.quality.missing?.join(", ")}` : ""}
                  {" · "}{variant.quality.channelReady ? "channel ready" : "channel blocked"}
                </p>
                {(variant.quality.channelMessages ?? []).slice(0, 3).map((message) => <p key={message} className="missing">{message}</p>)}
                <div className="fields">
                  {data.schema.definitions.filter((def) => def.scope === "sku" && def.key !== "sku").map((def) => (
                    <Field key={def.key} name={`sku.${variant.id}.${def.key}`} def={def} value={def.key === "mrp" ? variant.mrp : def.key === "size" ? variant.size : def.key === "barcode" ? variant.barcode : variant.values[def.key]} picklists={data.schema.picklists} disabled={!writable} />
                  ))}
                </div>
              </article>
            ))}
          </section>
        ))}
        {writable || can(hub.role, "catalog.status") ? <button className="btn" type="submit">Save style</button> : <p className="help">Your role can read this style.</p>}
      </form>
      {writable ? data.colors.map((color) => (
        <form key={color.id} id={`upload-${color.id}`} action="/api/media/upload" method="post" encType="multipart/form-data" className="card">
          <input type="hidden" name="colorGroupId" value={color.id} />
          <input type="hidden" name="productId" value={id} />
          <label>Image for {color.color_name}<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required /></label>
          <label>Role
            <select name="role" defaultValue="main"><option value="main">Main</option><option value="alternate">Alternate</option></select>
          </label>
          <button className="btn secondary" type="submit">Upload</button>
        </form>
      )) : null}
      <section className="group">
        <h2>Recent changes</h2>
        <ul>
          {data.history.map((event) => (
            <li key={`${event.created_at}-${event.operation}`}>{event.operation} via {event.source} · {new Date(event.created_at).toLocaleString()} {event.note ? `· ${event.note}` : ""}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
