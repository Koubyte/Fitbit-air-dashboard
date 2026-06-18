import { NextRequest, NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET(request: NextRequest) {
  const publicBaseUrl = process.env.PUBLIC_APP_URL || new URL(request.url).origin;
  const redirectUri = new URL("/api/auth/callback", publicBaseUrl).toString();
  const res = await fetch(
    backendUrl(`/api/auth/url?redirect_uri=${encodeURIComponent(redirectUri)}`),
    { cache: "no-store" }
  );

  if (!res.ok) {
    const message = await res.text();
    return NextResponse.json({ error: "oauth_not_configured", message }, { status: 503 });
  }

  const data = await res.json();
  return NextResponse.redirect(data.url);
}
