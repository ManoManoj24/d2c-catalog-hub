import { NextResponse } from "next/server";
import { authenticate } from "@/server/identity";
import { writeSession } from "@/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const user = await authenticate(email, password);
  if (!user) return NextResponse.redirect(new URL("/login?error=Email+or+password+is+wrong", request.url));
  await writeSession(user.id);
  return NextResponse.redirect(new URL("/", request.url));
}
