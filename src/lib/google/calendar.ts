/**
 * Google Calendar Integration Interfaces (Phase 3 Stubs)
 *
 * Prepared for bidirectional synchronization:
 * - OAuth2 token exchange and refresh
 * - ItemNode -> Google Event mapping
 * - Google Event -> ItemNode mapping
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

export interface GoogleSyncResult {
  success: boolean;
  google_event_id?: string;
  error?: string;
}
