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
  attendees?: { email: string }[];
}

export interface GoogleContactSuggestion {
  email: string;
  name?: string;
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
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
}

export interface GoogleSyncResult {
  success: boolean;
  google_event_id?: string;
  htmlLink?: string;
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

/**
 * Resolves the active Google OAuth provider_token from localStorage or active Supabase session.
 */
export async function resolveGoogleProviderToken(): Promise<string | null> {
  const existing = getGcalAccessToken();
  if (existing) return existing;

  try {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    const pt = data.session?.provider_token;
    if (pt) {
      setGcalTokens(pt, data.session?.provider_refresh_token);
      return pt;
    }
  } catch {
    // ignore
  }
  return null;
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
      const rawHash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(rawHash);
      const pt = params.get("provider_token");
      if (pt) {
        setGcalTokens(pt, params.get("provider_refresh_token"));
        params.delete("provider_token");
        params.delete("provider_refresh_token");
        const cleanHash = params.toString() ? `#${params.toString()}` : "";
        window.history.replaceState(
          {},
          "",
          window.location.pathname + window.location.search + cleanHash
        );
      }
    }
  } catch (e) {
    console.warn("[gcal] error parsing hash for tokens:", e);
  }
}

if (typeof window !== "undefined") {
  checkUrlForGoogleTokens();
}

let isConnectingGcal = false;

/**
 * Connects Google Calendar exclusively via Supabase OAuth (avoiding direct GIS popup / origin_mismatch).
 */
export async function connectGoogleCalendar(returnUrl = "/today"): Promise<boolean> {
  if (isConnectingGcal) return false;
  isConnectingGcal = true;

  try {
    const sb = getSupabase();
    if (!sb) throw new Error("Supabase não configurado");
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(returnUrl)}`;

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
  } finally {
    isConnectingGcal = false;
  }
}

/**
 * Fetches events from primary Google Calendar in given date window.
 * Filters out cancelled events and replaces cached events when Google responds authoritatively.
 * NEVER opens background popups if token is expired.
 */
export async function fetchGoogleCalendarEvents(
  timeMin: Date,
  timeMax: Date,
  onAuthoritativeSync?: (activeEvents: GoogleCalendarEvent[]) => void
): Promise<GoogleCalendarEvent[]> {
  const token = await resolveGoogleProviderToken();

  // If no token exists, return cached events without attempting background popups
  if (!token) {
    return getCachedGcalEvents();
  }

  try {
    // 1. Try same-origin Next.js proxy route first (immune to Edge tracking prevention & CORS)
    let res: Response | null = null;
    try {
      const proxyUrl = new URL(
        "/api/gcal/events",
        typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
      );
      proxyUrl.searchParams.set("timeMin", timeMin.toISOString());
      proxyUrl.searchParams.set("timeMax", timeMax.toISOString());
      proxyUrl.searchParams.set("_t", String(Date.now()));

      res = await fetch(proxyUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch (proxyErr) {
      console.warn("[gcal] proxy route request failed, trying direct googleapis:", proxyErr);
    }

    // 2. If proxy route failed or returned error, try direct Google API
    if (!res || !res.ok) {
      if (res?.status === 401) {
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
        directUrl.searchParams.set("showDeleted", "false");
        directUrl.searchParams.set("orderBy", "startTime");
        directUrl.searchParams.set("maxResults", "250");

        res = await fetch(directUrl.toString(), {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          cache: "no-store",
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
    const fetched: GoogleCalendarEvent[] = (data.items || [])
      .filter((e: any) => e && e.status !== "cancelled")
      .map((e: any) => ({
        id: e.id,
        summary: e.summary || "Sem título",
        description: e.description || "",
        start: e.start,
        end: e.end,
        htmlLink: e.htmlLink,
        attendees: Array.isArray(e.attendees) ? e.attendees : undefined,
      }));

    // Replace persistent cache with authoritative Google response
    setCachedGcalEvents(fetched);
    onAuthoritativeSync?.(fetched);
    return fetched;
  } catch (err) {
    console.warn("[gcal] fetch error caught safely:", err);
    return getCachedGcalEvents();
  }
}

/**
 * Checks whether a specific Google Calendar event ID still exists and is not cancelled.
 */
export async function verifyGoogleCalendarEvent(
  eventId: string
): Promise<"active" | "deleted" | "unknown"> {
  if (!eventId) return "unknown";
  const token = await resolveGoogleProviderToken();
  if (!token) return "unknown";

  try {
    const proxyUrl = new URL(
      "/api/gcal/events",
      typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"
    );
    proxyUrl.searchParams.set("eventId", eventId);
    proxyUrl.searchParams.set("_t", String(Date.now()));

    let res: Response | null = null;
    try {
      res = await fetch(proxyUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
    } catch {
      // fallback to direct
    }

    if (!res) {
      res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          cache: "no-store",
        }
      );
    }

    if (res.status === 404 || res.status === 410) {
      return "deleted";
    }
    if (!res.ok) {
      return "unknown";
    }
    const data = await res.json();
    if (data?.status === "cancelled" || data?.deleted === true) {
      return "deleted";
    }
    return "active";
  } catch {
    return "unknown";
  }
}

/**
 * Creates or updates an event on user's primary Google Calendar
 */
export async function createGoogleCalendarEvent(item: {
  id?: string;
  title: string;
  content?: string;
  attendees?: string[];
  schedule: {
    start_time: string | null;
    end_time: string | null;
    google_event_id?: string | null;
  };
}): Promise<GoogleSyncResult> {
  const token = await resolveGoogleProviderToken();
  if (!token) {
    return {
      success: false,
      error: isGcalConnected()
        ? "Sua sessão do Google Agenda expirou. Clique em Reconectar Google Agenda."
        : "Google Calendar não conectado. Conecte sua conta Google primeiro.",
    };
  }
  if (!item.schedule.start_time) {
    return { success: false, error: "Preencha a data e hora de INÍCIO antes de criar o evento." };
  }

  try {
    const startTime = new Date(item.schedule.start_time);
    const endTime = item.schedule.end_time
      ? new Date(item.schedule.end_time)
      : new Date(startTime.getTime() + 60 * 60 * 1000);

    const cleanBody = item.content?.replace(/<[^>]*>?/gm, "").trim().slice(0, 600) || "";
    const returnLink =
      typeof window !== "undefined" && item.id
        ? `${window.location.origin}/page/${item.id}`
        : "";
    const description = [
      cleanBody,
      returnLink ? `🔗 Tarefa no Ayolia: ${returnLink}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const attendeesPayload = Array.isArray(item.attendees)
      ? item.attendees
          .map((email) => email.trim().toLowerCase())
          .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          .map((email) => ({ email }))
      : [];

    const payload: GoogleEventPayload = {
      summary: item.title || "Sem título",
      description,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      ...(attendeesPayload.length > 0 ? { attendees: attendeesPayload } : {}),
    };

    const existingEventId = item.schedule.google_event_id || null;
    const proxyEndpoint = existingEventId
      ? `/api/gcal/events?eventId=${encodeURIComponent(existingEventId)}`
      : "/api/gcal/events";

    // Try same-origin proxy first
    let res: Response | null = null;
    try {
      res = await fetch(proxyEndpoint, {
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
      if (res?.status === 401) {
        localStorage.removeItem(STORAGE_TOKEN_KEY);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("gcal-status-change"));
        }
        return {
          success: false,
          error: "Sessão do Google expirada (401). Clique para reconectar sua conta Google.",
        };
      }

      const directBase = existingEventId
        ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(existingEventId)}`
        : "https://www.googleapis.com/calendar/v3/calendars/primary/events";
      const directUrl = new URL(directBase);
      if (attendeesPayload.length > 0) {
        directUrl.searchParams.set("sendUpdates", "all");
      }

      res = await fetch(directUrl.toString(), {
        method: existingEventId ? "PUT" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      if (res.status === 401) {
        localStorage.removeItem(STORAGE_TOKEN_KEY);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("gcal-status-change"));
        }
        return {
          success: false,
          error: "Sessão do Google expirada (401). Clique para reconectar sua conta Google.",
        };
      }
      const errText = await res.text();
      return { success: false, error: errText };
    }

    const data = await res.json();
    return {
      success: true,
      google_event_id: data.id,
      htmlLink: data.htmlLink || undefined,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Erro ao criar evento no Google Calendar" };
  }
}

let cachedGoogleContacts: GoogleContactSuggestion[] | null = null;

/**
 * Fetches contact email suggestions from Google People API (if token has permission)
 * and merges with attendees seen in cached Google Calendar events.
 * Always resolves safely to an array (never throws).
 */
export async function fetchGoogleContactSuggestions(): Promise<GoogleContactSuggestion[]> {
  if (typeof window === "undefined") return [];
  const map = new Map<string, GoogleContactSuggestion>();

  // 1. Extract any attendees from cached Google Calendar events
  try {
    const cachedEvents = getCachedGcalEvents();
    for (const ev of cachedEvents) {
      for (const att of ev.attendees ?? []) {
        if (att.email) {
          const email = att.email.trim().toLowerCase();
          if (!map.has(email)) {
            map.set(email, { email, name: att.displayName });
          }
        }
      }
    }
  } catch {
    // ignore
  }

  if (cachedGoogleContacts) {
    for (const c of cachedGoogleContacts) {
      map.set(c.email, c);
    }
    return Array.from(map.values());
  }

  const token = getGcalAccessToken();
  if (!token) {
    return Array.from(map.values());
  }

  try {
    const endpoints = [
      "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=100",
      "https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses&pageSize=100",
    ];

    for (const url of endpoints) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const list = data.connections || data.otherContacts || [];
      for (const person of list) {
        const name = person.names?.[0]?.displayName as string | undefined;
        for (const em of person.emailAddresses ?? []) {
          const val = (em.value as string | undefined)?.trim().toLowerCase();
          if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
            map.set(val, { email: val, name });
          }
        }
      }
    }
    cachedGoogleContacts = Array.from(map.values());
  } catch {
    // Resilient fallback when People API is not enabled or lacks scope
  }

  return Array.from(map.values());
}
