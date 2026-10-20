import { getSupabase } from "../supabase/client";

/**
 * Google Calendar Integration Module
 *
 * Provides bidirectional sync:
 * - OAuth2 connect via Supabase with Google Calendar scopes
 * - Fetching events from Google Calendar API
 * - Mapping between Google Events and êntusis ItemNode
 */

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
}

export const GCAL_DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export interface GoogleEventPayload {
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
}

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  htmlLink?: string;
}

export interface GoogleSyncResult {
  success: boolean;
  google_event_id?: string;
  error?: string;
}

export function getGcalAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("gcal_access_token");
}

export function setGcalTokens(access: string, refresh?: string | null) {
  if (typeof window === "undefined") return;
  localStorage.setItem("gcal_access_token", access);
  if (refresh) localStorage.setItem("gcal_refresh_token", refresh);
  localStorage.setItem("gcal_connected_at", Date.now().toString());
}

export function disconnectGcal() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("gcal_access_token");
  localStorage.removeItem("gcal_refresh_token");
  localStorage.removeItem("gcal_connected_at");
}

export function isGcalConnected(): boolean {
  return Boolean(getGcalAccessToken());
}

/**
 * Triggers Google OAuth with Google Calendar scopes
 */
export async function connectGoogleCalendar(returnUrl = "/today") {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase não configurado");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const redirectTo = `${origin}${returnUrl}${returnUrl.includes("?") ? "&" : "?"}gcal=connected`;

  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      scopes: GCAL_DEFAULT_SCOPES.join(" "),
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });
  if (error) throw error;
}

/**
 * Fetches events from primary Google Calendar in given date window
 */
export async function fetchGoogleCalendarEvents(timeMin: Date, timeMax: Date): Promise<GoogleCalendarEvent[]> {
  const token = getGcalAccessToken();
  if (!token) return [];

  try {
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", timeMin.toISOString());
    url.searchParams.set("timeMax", timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "100");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Token expired or invalid
        disconnectGcal();
        return [];
      }
      const errText = await res.text();
      console.warn("[gcal] failed to fetch events:", errText);
      return [];
    }

    const data = await res.json();
    return (data.items || []).map((e: any) => ({
      id: e.id,
      summary: e.summary || "Sem título",
      description: e.description || "",
      start: e.start,
      end: e.end,
      htmlLink: e.htmlLink,
    }));
  } catch (err) {
    console.error("[gcal] fetch error:", err);
    return [];
  }
}

/**
 * Creates an event on user's primary Google Calendar
 */
export async function createGoogleCalendarEvent(item: {
  title: string;
  content?: string;
  schedule: { start_time: string | null; end_time: string | null };
}): Promise<GoogleSyncResult> {
  const token = getGcalAccessToken();
  if (!token) return { success: false, error: "Google Calendar não conectado" };
  if (!item.schedule.start_time) return { success: false, error: "Sem horário agendado" };

  try {
    const startTime = new Date(item.schedule.start_time);
    const endTime = item.schedule.end_time
      ? new Date(item.schedule.end_time)
      : new Date(startTime.getTime() + 60 * 60 * 1000);

    const payload: GoogleEventPayload = {
      summary: item.title,
      description: item.content?.replace(/<[^>]*>?/gm, "").slice(0, 500) || "",
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
    };

    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: err };
    }

    const data = await res.json();
    return { success: true, google_event_id: data.id };
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao criar evento no Google Calendar" };
  }
}
