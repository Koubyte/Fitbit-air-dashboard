import { NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

function safeDetail(value: string) {
  return value
    .replace(/code=[^&\s"]+/g, "code=REDACTED")
    .replace(/[A-Za-z0-9_-]{80,}/g, "REDACTED")
    .slice(0, 220);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const publicBaseUrl = process.env.PUBLIC_APP_URL || url.origin;
  const home = new URL("/", publicBaseUrl);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    home.searchParams.set("auth", "error");
    home.searchParams.set("auth_detail", safeDetail(error || "missing_code"));
    return NextResponse.redirect(home);
  }

  const redirectUri = new URL("/api/auth/callback", publicBaseUrl).toString();
  const res = await fetch(
    backendUrl(
      `/api/auth/callback?code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`
    ),
    { cache: "no-store" }
  );

  home.searchParams.set("auth", res.ok ? "ok" : "error");
  if (!res.ok) {
    home.searchParams.set("auth_detail", safeDetail(await res.text()));
  }
  return NextResponse.redirect(home);
}
