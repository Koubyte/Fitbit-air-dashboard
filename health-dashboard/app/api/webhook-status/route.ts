import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET() {
  try {
    const res = await fetch(backendUrl("/api/webhook-status"), {
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "backend_unavailable", status: res.status },
        { status: 503 }
      );
    }

    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(
      { error: "backend_unavailable" },
      { status: 503 }
    );
  }
}
