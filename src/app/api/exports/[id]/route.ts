import { NextResponse } from "next/server";
import { requireApiHub } from "@/server/context";
import { withTenant } from "@/server/db";
import { objectStore } from "@/server/object-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const hub = await requireApiHub();
  const { id } = await context.params;
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
  const row = await withTenant(hub.tenantId, hub.user.id, async (client) => {
    const result = await client.query<{ receipt: { csvKey?: string; xlsxKey?: string } }>(
      `SELECT receipt FROM export_jobs WHERE id = $1 AND catalog_id = $2`,
      [id, hub.catalogId],
    );
    return result.rows[0];
  });
  const key = format === "csv" ? row?.receipt.csvKey : row?.receipt.xlsxKey;
  if (!key || !key.startsWith(`tenants/${hub.tenantId}/`)) return NextResponse.json({ ok: false, error: "Export not found." }, { status: 404 });
  const file = await objectStore().get(key);
  if (!file) return NextResponse.json({ ok: false, error: "File missing." }, { status: 404 });
  return new NextResponse(new Uint8Array(file.body), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="kidswear-channel.${format}"`,
    },
  });
}
