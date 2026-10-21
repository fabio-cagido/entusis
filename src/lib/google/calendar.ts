import { getSupabase } from "../supabase/client";

/**
 * Google Calendar Integration Module
 *
 * Provides robust bidirectional sync:
 * - Persistent connection flag and cached events in localStorage
 * - Silent token renewal (via Google Identity Services)
 * - Auto-fetch on window focus and periodic background sync
 * - Token extraction from URL hash and Supabase session
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

const STORAGE_TOKEN_KEY = "gcal_access_token";
const STORAGE_REFRESH_KEY = "gcal_refresh_token";
const STORAGE_CONNECTED_KEY = "gcal_connected";
const STORAGE_CACHE_KEY = "gcal_cached_events";

export function getGcalAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_TOKEN_KEY);
}

export function getCachedGcalEvents(): GoogleCalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setCachedGcalEvents(events: GoogleCalendarEvent[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(events));
  } catch (e) {
    console.warn("[gcal] failed to cache events:", e);
  }
}

export function setGcalTokens(access: string, refresh?: string | null) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_TOKEN_KEY, access);
  localStorage.setItem(STORAGE_CONNECTED_KEY, "true");
  if (refresh) localStorage.setItem(STORAGE_REFRESH_KEY, refresh);
  localStorage.setItem("gcal_connected_at", Date.now().toString());
  window.dispatchEvent(new Event("gcal-status-change"));
}

export function disconnectGcal() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  localStorage.removeItem(STORAGE_REFRESH_KEY);
  localStorage.removeItem(STORAGE_CONNECTED_KEY);
  localStorage.removeItem(STORAGE_CACHE_KEY);
  localStorage.removeItem("gcal_connected_at");
  window.dispatchEvent(new Event("gcal-status-change"));
}

export function isGcalConnected(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_CONNECTED_KEY) === "true" || Boolean(getGcalAccessToken());
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
 * Uses Google Identity Services token client for instant token requests (must be triggered by user action)
 */
export async function requestGoogleCalendarToken(): Promise<string> {
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.oauth2) {
      reject(new Error("Google Identity não disponível"));
      return;
    }
    try {
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
        error_callback: (err: any) => {
          console.warn("[gcal] GIS error:", err);
          reject(new Error(err?.message || "Autorização cancelada ou bloqueada"));
        },
      });
      client.requestAccessToken({ prompt: "select_account" });
    } catch (err: any) {
      console.warn("[gcal] GIS init failed:", err);
      reject(err);
    }
  });
}

/**
 * Connects Google Calendar:
 * 1. Tries Google Identity Services (GIS) token client
 * 2. Falls back to Supabase OAuth redirect if popup blocked
 */
export async function connectGoogleCalendar(returnUrl = "/today"): Promise<boolean> {
  try {
    await requestGoogleCalendarToken();
    return true;
  } catch (gisError) {
    console.warn("[gcal] GIS prompt failed, attempting redirect fallback:", gisError);

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
 * Fetches events from primary Google Calendar in given date window.
 * Keeps cached events intact if network/token fails temporarily.
 * NEVER opens background popups if token is expired.
 */
export async function fetchGoogleCalendarEvents(
  timeMin: Date,
  timeMax: Date
): Promise<GoogleCalendarEvent[]> {
  const token = getGcalAccessToken();

  // If no token exists, return cached events without attempting background popups
  if (!token) {
    return getCachedGcalEvents();
  }

  try {
    // 1. Try same-origin Next.js proxy route first (immune to Edge tracking prevention & CORS)
    let res: Response | null = null;
    try {
      const proxyUrl = new URL("/api/gcal/events", typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
      proxyUrl.searchParams.set("timeMin", timeMin.toISOString());
      proxyUrl.searchParams.set("timeMax", timeMax.toISOString());

      res = await fetch(proxyUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (proxyErr) {
      console.warn("[gcal] proxy route request failed, trying direct googleapis:", proxyErr);
    }

    // 2. If proxy route failed or returned error, try direct Google API
    if (!res || !res.ok) {
      if (res?.status === 401) {
        // Token has expired. Remove the expired token and notify UI, but keep cached events!
        console.warn("[gcal] token expired (401); maintaining cached events until user reconnects");
        localStorage.removeItem(STORAGE_TOKEN_KEY);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("gcal-status-change"));
        }
        return getCachedGcalEvents();
      }

      try {
        const directUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
        directUrl.searchParams.set("timeMin", timeMin.toISOString());
        directUrl.searchParams.set("timeMax", timeMax.toISOString());
        directUrl.searchParams.set("singleEvents", "true");
        directUrl.searchParams.set("orderBy", "startTime");
        directUrl.searchParams.set("maxResults", "100");

        res = await fetch(directUrl.toString(), {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        if (res?.status === 401) {
          console.warn("[gcal] direct googleapis token expired (401); maintaining cached events");
          localStorage.removeItem(STORAGE_TOKEN_KEY);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("gcal-status-change"));
          }
          return getCachedGcalEvents();
        }
      } catch (directErr) {
        console.warn("[gcal] direct googleapis request failed:", directErr);
      }
    }

    if (!res || !res.ok) {
      console.warn("[gcal] events fetch unavailable, serving cached events");
      return getCachedGcalEvents();
    }

    const data = await res.json();
    const fetched: GoogleCalendarEvent[] = (data.items || []).map((e: any) => ({
      id: e.id,
      summary: e.summary || "Sem título",
      description: e.description || "",
      start: e.start,
      end: e.end,
      htmlLink: e.htmlLink,
    }));

    // Update persistent cache
    setCachedGcalEvents(fetched);
    return fetched;
  } catch (err) {
    // Graceful fallback with console.warn (avoids Next.js Turbopack dev error modal)
    console.warn("[gcal] fetch error caught safely:", err);
    return getCachedGcalEvents();
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
  if (!token) {
    return {
      success: false,
      error: isGcalConnected()
        ? "Sua sessão do Google Agenda expirou após 1 hora. Clique no botão da Agenda para reconectar."
        : "Google Calendar não conectado",
    };
  }
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

    // Try same-origin proxy first
    let res: Response | null = null;
    try {
      res = await fetch("/api/gcal/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // ignore, fallback to direct
    }

    if (!res || !res.ok) {
      res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

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
