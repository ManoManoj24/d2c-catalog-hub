import { NextResponse } from "next/server";
import { getAppPool } from "@/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await getAppPool().query("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "database unavailable";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
