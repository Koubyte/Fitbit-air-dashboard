import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Fitbit Dashboard"' },
  });
}

export function proxy(request: NextRequest) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) return NextResponse.next();

  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/_next") ||
    path === "/favicon.ico" ||
    path.startsWith("/api/auth/callback") ||
    path.startsWith("/api/webhooks/google-health")
  ) {
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(auth.slice("Basic ".length));
  const splitAt = decoded.indexOf(":");
  if (splitAt < 0) return unauthorized();

  const authUser = decoded.slice(0, splitAt);
  const authPassword = decoded.slice(splitAt + 1);

  if (authUser === user && authPassword === password) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
};
