import { can } from "@/domain/authz";
import { requireHub } from "@/server/context";

export default async function NewImportPage() {
  const hub = await requireHub();
  if (!can(hub.role, "catalog.write")) return <p>Your role cannot import.</p>;
  return (
    <>
      <div className="top">
        <div>
          <h1>Upload a catalog</h1>
          <p className="lede">CSV or XLSX. One row per size SKU, with the style and color repeated. The sample file is <code>samples/kidswear-catalog.csv</code>.</p>
        </div>
      </div>
      <form className="card stack" action="/api/imports" method="post" encType="multipart/form-data">
        <label>File<input type="file" name="file" accept=".csv,.xlsx,text/csv" required /></label>
        <label>When rows have errors
          <select name="mode" defaultValue="atomic">
            <option value="atomic">Block the whole commit</option>
            <option value="partial">Commit only valid rows</option>
          </select>
        </label>
        <button className="btn" type="submit">Upload and inspect</button>
      </form>
    </>
  );
}
