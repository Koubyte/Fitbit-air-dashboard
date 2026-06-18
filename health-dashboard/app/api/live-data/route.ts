import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function GET() {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000); // 10-second timeout

  try {
    const res = await fetch(backendUrl("/api/health-data"), {
      signal: controller.signal,
      cache: "no-store", // Do not cache proxy responses at Next.js server layer
    });
    
    clearTimeout(id);

    if (!res.ok) {
      return NextResponse.json(
        {
          error: "backend_unavailable",
          message: `Backend returned status ${res.status}: ${res.statusText}`,
        },
        { status: 503 }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    clearTimeout(id);
    const errorName = error instanceof Error ? error.name : "";
    return NextResponse.json(
      {
        error: "backend_unavailable",
        message: errorName === "AbortError"
          ? "Request to the Python service timed out after 10 seconds."
          : "The Google Health gateway service is unavailable.",
      },
      { status: 503 }
    );
  }
}
