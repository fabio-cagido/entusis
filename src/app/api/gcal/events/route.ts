import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const eventId = searchParams.get("eventId");
  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");

  if (eventId) {
    const singleUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
    try {
      const res = await fetch(singleUrl, {
        headers: {
          Authorization: authHeader,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (res.status === 404 || res.status === 410) {
        return NextResponse.json(
          { status: "cancelled", deleted: true },
          { status: 404, headers: { "Cache-Control": "no-store" } }
        );
      }
      const data = await res.json();
      return NextResponse.json(data, {
        status: res.status,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Failed to contact Google Calendar" },
        { status: 502 }
      );
    }
  }

  const gcalUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  if (timeMin) gcalUrl.searchParams.set("timeMin", timeMin);
  if (timeMax) gcalUrl.searchParams.set("timeMax", timeMax);
  gcalUrl.searchParams.set("singleEvents", "true");
  gcalUrl.searchParams.set("showDeleted", "false");
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
    if (res.ok && Array.isArray(data?.items)) {
      data.items = data.items.filter((item: any) => item && item.status !== "cancelled");
    }
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
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
    const { searchParams } = new URL(req.url);
    const eventId = searchParams.get("eventId");
    const body = await req.json();
    const hasAttendees = Array.isArray(body?.attendees) && body.attendees.length > 0;
    const baseUrl = eventId
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`
      : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    const targetUrl = new URL(baseUrl);
    if (hasAttendees) {
      targetUrl.searchParams.set("sendUpdates", "all");
    }

    const res = await fetch(targetUrl.toString(), {
      method: eventId ? "PUT" : "POST",
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
