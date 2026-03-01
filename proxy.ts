import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "site_auth";

function isPublicPath(pathname: string) {
  return pathname === "/auth" || pathname.startsWith("/api/auth");
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const isAuthenticated = req.cookies.get(AUTH_COOKIE)?.value === "1";
  if (isAuthenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/auth", req.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"
  ]
};
