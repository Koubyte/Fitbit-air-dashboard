import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = searchParams.get("days") ?? "30";

  try {
    const res = await fetch(backendUrl(`/api/google-health-diagnostics?days=${encodeURIComponent(days)}`), {
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "backend_unavailable",
          message: `Backend returned status ${res.status}: ${res.statusText}`,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(
      {
        error: "backend_unavailable",
        message: "The Google Health gateway service is unavailable.",
      },
      { status: 503 }
    );
  }
}
