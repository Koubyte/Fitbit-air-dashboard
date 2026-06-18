import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export const runtime = "nodejs";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export async function POST(request: Request) {
  const expectedAuth = process.env.GOOGLE_HEALTH_WEBHOOK_AUTHORIZATION;
  if (!expectedAuth) {
    return NextResponse.json(
      { error: "webhook_not_configured" },
      { status: 503 }
    );
  }

  const authorization = request.headers.get("authorization") || "";
  if (authorization !== expectedAuth) return unauthorized();

  const rawBody = await request.text();
  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if ((payload as { type?: string }).type === "verification") {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(backendUrl("/api/webhooks/google-health"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Forward-Secret": process.env.WEBHOOK_FORWARD_SECRET || "",
      },
      body: rawBody,
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json(
        { error: "backend_webhook_failed", status: res.status },
        { status: 503 }
      );
    }

    return new Response(null, { status: 204 });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json({ error: "backend_webhook_unreachable" }, { status: 503 });
  }
}
