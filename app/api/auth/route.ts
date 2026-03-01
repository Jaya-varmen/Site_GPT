import { NextResponse } from "next/server";

const AUTH_COOKIE = "site_auth";
const APP_PASSWORD = (process.env.APP_PASSWORD ?? "33405").trim();

export const runtime = "nodejs";

function isSecureRequest(req: Request) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const password = typeof body?.password === "string" ? body.password.trim() : "";
  const secureCookie = isSecureRequest(req);

  if (password !== APP_PASSWORD) {
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE,
    value: "1",
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  });

  return response;
}

export async function DELETE(req: Request) {
  const secureCookie = isSecureRequest(req);
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE,
    value: "",
    httpOnly: true,
    secure: secureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
  return response;
}
