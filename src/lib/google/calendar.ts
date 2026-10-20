import { getSupabase } from "../supabase/client";

/**
 * Google Calendar Integration Module
 *
 * Provides bidirectional sync:
 * - Google Identity Services (instant popup OAuth token client)
 * - OAuth2 fallback via Supabase
 * - Token storage & auto-detection from URL hash
 * - Fetching events from Google Calendar API v3
 * - Mapping between Google Events and êntusis ItemNode
 */

export const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "222771488153-iadl0hbipvr8kovtij749rkic8m9knfv.apps.googleusercontent.com";

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
  // Dispatch a custom event so components can update immediately
  window.dispatchEvent(new Event("gcal-status-change"));
}

export function disconnectGcal() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("gcal_access_token");
  localStorage.removeItem("gcal_refresh_token");
  localStorage.removeItem("gcal_connected_at");
  window.dispatchEvent(new Event("gcal-status-change"));
}

export function isGcalConnected(): boolean {
  return Boolean(getGcalAccessToken());
}

/**
 * Check URL hash for provider_token from Supabase OAuth redirect
 */
export function checkUrlForGoogleTokens() {
  if (typeof window === "undefined") return;
  try {
    if (window.location.hash) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const pt = params.get("provider_token");
      if (pt) {
        setGcalTokens(pt, params.get("provider_refresh_token"));
      }
    }
  } catch (e) {
    console.warn("[gcal] error parsing hash for tokens:", e);
  }
}

// Check tokens immediately on module import
if (typeof window !== "undefined") {
  checkUrlForGoogleTokens();
}

/**
 * Dynamically loads the official Google Identity Services script
 */
export function loadGsiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const existing = document.getElementById("gsi-client-script");
    if (existing) {
      if ((window as any).google?.accounts?.oauth2) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
      }
      return;
    }
    const script = document.createElement("script");
    script.id = "gsi-client-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar script do Google Identity"));
    document.head.appendChild(script);
  });
}

/**
 * Uses Google Identity Services token client for instant popup authentication
 */
export async function requestGoogleCalendarToken(): Promise<string> {
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      reject(new Error("Google Identity não disponível"));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GCAL_DEFAULT_SCOPES.join(" "),
      callback: (response: any) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        if (response.access_token) {
          setGcalTokens(response.access_token);
          resolve(response.access_token);
        } else {
          reject(new Error("Nenhum access_token recebido do Google"));
        }
      },
    });
    // Request access token (since permission was already given, Google returns token instantly)
    client.requestAccessToken({ prompt: "" });
  });
}

/**
 * Connects Google Calendar:
 * 1. Tries Google Identity Services (GIS) instant popup token
 * 2. Falls back to Supabase OAuth redirect if needed
 */
export async function connectGoogleCalendar(returnUrl = "/today"): Promise<boolean> {
  try {
    await requestGoogleCalendarToken();
    return true;
  } catch (gisError) {
    console.warn("[gcal] GIS popup failed or was blocked, falling back to redirect:", gisError);

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
    return false;
  }
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
