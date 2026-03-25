/**
 * Google Calendar integration — syncs deal closings, property visits,
 * lease expirations, and note payment dates.
 */

import { logger } from "../utils/logger";

interface CalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
}

interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_OAUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export function getGoogleOAuthUrl(redirectUri: string, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return "";

  const scopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
  ].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${GOOGLE_OAUTH_URL}?${params}`;
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokens | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  } catch (err) {
    logger.error("Google OAuth exchange failed", err instanceof Error ? err : undefined);
    return null;
  }
}

export async function createCalendarEvent(
  tokens: GoogleTokens,
  event: CalendarEvent
): Promise<boolean> {
  try {
    const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    });

    if (!res.ok) {
      logger.warn("Google Calendar event creation failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("Google Calendar API error", err instanceof Error ? err : undefined);
    return false;
  }
}

export function buildClosingEvent(
  propertyAddress: string,
  closingDate: string,
  titleCompany?: string
): CalendarEvent {
  return {
    summary: `Closing: ${propertyAddress}${titleCompany ? ` at ${titleCompany}` : ""}`,
    description: `AcreOS deal closing for ${propertyAddress}`,
    location: titleCompany || undefined,
    start: { date: closingDate },
    end: { date: closingDate },
  };
}

export function buildLeaseExpirationEvent(
  tenantName: string,
  propertyAddress: string,
  expirationDate: string
): CalendarEvent {
  return {
    summary: `Lease Expiring: ${propertyAddress} (${tenantName})`,
    description: `Lease for ${tenantName} at ${propertyAddress} expires on this date. Consider renewal or re-listing.`,
    start: { date: expirationDate },
    end: { date: expirationDate },
  };
}
