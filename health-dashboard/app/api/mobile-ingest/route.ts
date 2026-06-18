import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export const runtime = "nodejs";

function unauthorized() {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Fitbit Dashboard"' },
  });
}

function hasBasicAuth(request: Request) {
  const user = process.env.DASHBOARD_USER;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!user || !password) return false;

  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;

  const decoded = Buffer.from(auth.slice("Basic ".length), "base64").toString("utf8");
  const splitAt = decoded.indexOf(":");
  return splitAt > 0 && decoded.slice(0, splitAt) === user && decoded.slice(splitAt + 1) === password;
}

export async function POST(request: Request) {
  if (!hasBasicAuth(request)) return unauthorized();

  const rawBody = await request.text();
  const res = await fetch(backendUrl("/api/mobile-ingest"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
    cache: "no-store",
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
