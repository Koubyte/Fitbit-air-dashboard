import { NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const publicBaseUrl = process.env.PUBLIC_APP_URL || url.origin;
  const home = new URL("/", publicBaseUrl);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    home.searchParams.set("auth", "error");
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
  return NextResponse.redirect(home);
}
