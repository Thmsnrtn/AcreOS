/**
 * Public API v0 — resource serializers.
 *
 * Every resource exposed on /api/v1/* is shaped through one of these
 * functions. Two principles:
 *
 *   1. WHITELIST, never blacklist. New internal columns must be added
 *      to the serializer to leak — the default is private. Same posture
 *      Stripe takes with their snake_case public schema vs. internal
 *      camelCase columns.
 *
 *   2. snake_case on the wire. This is the public contract; internal
 *      camelCase column names stay internal. Renaming a column never
 *      breaks a customer integration.
 */

import type { Lead, Property, WebhookSubscription } from "@shared/schema";

export interface PublicLead {
  id: number;
  type: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  source: string | null;
  tags: string[] | null;
  score: number | null;
  do_not_contact: boolean;
  tcpa_consent: boolean;
  created_at: string;
  updated_at: string;
}

export function serializeLead(lead: Lead): PublicLead {
  return {
    id: lead.id,
    type: lead.type,
    first_name: lead.firstName,
    last_name: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    address: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    status: lead.status,
    source: lead.source,
    tags: lead.tags ?? null,
    score: lead.score,
    do_not_contact: lead.doNotContact ?? false,
    tcpa_consent: lead.tcpaConsent ?? false,
    created_at: (lead.createdAt ?? new Date()).toISOString(),
    updated_at: (lead.updatedAt ?? new Date()).toISOString(),
  };
}

export interface PublicProperty {
  id: number;
  apn: string;
  county: string;
  state: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  size_acres: string;
  zoning: string | null;
  status: string;
  assessed_value: string | null;
  market_value: string | null;
  list_price: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeProperty(p: Property): PublicProperty {
  return {
    id: p.id,
    apn: p.apn,
    county: p.county,
    state: p.state,
    address: p.address,
    city: p.city,
    zip: p.zip,
    size_acres: String(p.sizeAcres),
    zoning: p.zoning,
    status: p.status,
    assessed_value: p.assessedValue !== null ? String(p.assessedValue) : null,
    market_value: p.marketValue !== null ? String(p.marketValue) : null,
    list_price: p.listPrice !== null ? String(p.listPrice) : null,
    created_at: (p.createdAt ?? new Date()).toISOString(),
    updated_at: (p.updatedAt ?? new Date()).toISOString(),
  };
}

export interface PublicWebhookSubscription {
  id: number;
  url: string;
  events: string[];
  is_active: boolean;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  // signing_secret only included in the create-response (one-time).
  signing_secret?: string;
  created_at: string;
}

export function serializeWebhookSubscription(
  w: WebhookSubscription,
  opts: { includeSecret?: boolean } = {},
): PublicWebhookSubscription {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    is_active: w.isActive,
    consecutive_failures: w.consecutiveFailures,
    last_success_at: w.lastSuccessAt?.toISOString() ?? null,
    last_failure_at: w.lastFailureAt?.toISOString() ?? null,
    ...(opts.includeSecret ? { signing_secret: w.signingSecret } : {}),
    created_at: w.createdAt.toISOString(),
  };
}
