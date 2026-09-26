import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  accessToken,
  codeMatches,
  gateEnabled,
} from "@/lib/access-gate";

export async function POST(request: Request) {
  if (!gateEnabled()) {
    return NextResponse.json({ ok: true });
  }

  let code = "";
  try {
    const body = await request.json();
    if (typeof body?.code === "string") code = body.code;
  } catch {
    code = "";
  }

  if (!codeMatches(code)) {
    return NextResponse.json({ error: "That code is not valid." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, accessToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  return response;
}
