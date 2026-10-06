import { NextResponse } from "next/server";
import Papa from "papaparse";
import type { Issue } from "@/domain/types";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const hub = await requireApiHub();
  const { id } = await context.params;
  const rows = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const result = await client.query<{ row_number: number; sku: string | null; issues: Issue[] }>(
      `SELECT row_number, sku, issues FROM import_rows WHERE import_job_id = $1 ORDER BY row_number`,
      [id],
    );
    return result.rows;
  });
  const flat = rows.flatMap((row) => (row.issues ?? []).filter((issue) => issue.severity === "error").map((issue) => ({
    row: row.row_number,
    sku: row.sku,
    attribute: issue.attributeKey,
    rule: issue.rule,
    message: issue.message,
    proposed_fix: issue.proposedFix ?? "",
  })));
  const csv = Papa.unparse(flat);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="import-${id}-errors.csv"`,
    },
  });
}
