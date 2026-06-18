import { NextResponse } from "next/server";
import { backendUrl } from "@/lib/backend";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    const res = await fetch(backendUrl("/api/settings"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: body.clientId,
        client_secret: body.clientSecret,
        age: body.age,
        max_hr: body.maxHR,
        resting_hr: body.restingHR,
        target_sleep_hours: body.targetSleepHours,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: "backend_error", message: errText },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "backend_unavailable", message },
      { status: 503 }
    );
  }
}
