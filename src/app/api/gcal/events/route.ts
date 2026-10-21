import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");

  const gcalUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  if (timeMin) gcalUrl.searchParams.set("timeMin", timeMin);
  if (timeMax) gcalUrl.searchParams.set("timeMax", timeMax);
  gcalUrl.searchParams.set("singleEvents", "true");
  gcalUrl.searchParams.set("orderBy", "startTime");
  gcalUrl.searchParams.set("maxResults", "250");

  try {
    const res = await fetch(gcalUrl.toString(), {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to contact Google Calendar" },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create Google Calendar event" },
      { status: 502 }
    );
  }
}
