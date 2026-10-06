import { NextResponse } from "next/server";
import { clearSession } from "@/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await clearSession();
  return NextResponse.redirect(new URL("/login", request.url));
}
