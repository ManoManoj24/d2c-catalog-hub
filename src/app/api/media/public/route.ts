import { NextResponse } from "next/server";
import { objectStore } from "@/server/object-store";
import { verifyObject } from "@/server/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const exp = Number(url.searchParams.get("exp") ?? "0");
  const sig = url.searchParams.get("sig") ?? "";
  if (!verifyObject(key, exp, sig)) return NextResponse.json({ ok: false, error: "Link expired." }, { status: 403 });
  const file = await objectStore().get(key);
  if (!file) return NextResponse.json({ ok: false, error: "Missing file." }, { status: 404 });
  return new NextResponse(new Uint8Array(file.body), { headers: { "content-type": file.contentType, "cache-control": "public, max-age=3600" } });
}
