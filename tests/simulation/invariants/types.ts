/**
 * What the invariant monitor sees after each simulated tick.
 *
 * An observation is the world's EVIDENCE since the previous tick, read from
 * the outside of the product (the db tap, the provider stand-in log, the
 * egress ledger, the DB, the harness's own record of what the founder was
 * shown and tapped) — never from the product's own claims about itself.
 * Every field is optional so a collector that cannot read a source says so
 * (`unread`), and the monitor counts an unread source as UNKNOWN, never clean.
 */

export interface QueryEvent {
  /** Tenant the request was acting as (null = no request context: a job, a webhook). */
  actorOrg: number | null;
  /** The founder's own requests read across tenants by design. */
  actorIsFounder?: boolean;
  kind: "read" | "write";
  table?: string;
  /** organization_id values on the rows the query returned or touched. */
  rowOrgs: number[];
  sql?: string;
}

export interface TenantWriteEvent {
  actorOrg: number;
  rowOrg: number;
  table: string;
  op: string;
}

export type Rail = "ses" | "sendgrid" | "twilio" | "lob" | "stripe" | "meta";
export interface ProviderCall {
  rail: Rail;
  at: string;
  from?: string | null;
  to: string[];
  /** Stripe: the connected account the call ran on (Stripe-Account header); null = the platform account. */
  account?: string | null;
  amountCents?: number | null;
  /** Stripe: what the money is (from metadata / path); see moneyKind. */
  moneyKind?: "subscription" | "credits" | "refund" | "customer_money" | "unknown";
  path?: string;
  /** Meta: daily budget in cents on a create. */
  dailyBudgetCents?: number | null;
}

export interface SendEvent {
  channel: "sms" | "email" | "mail";
  at: string;
  to: string;
  orgId: number | null;
  /** The product's own record of the recipient at send time. */
  leadDnc?: boolean;
  leadConsent?: boolean | null;
  /** Ground truth from the twin: when (if ever) this recipient revoked consent. */
  revokedAt?: string | null;
}

export interface ScreenEvent {
  surface: string;
  /** Text a person reads on this screen. */
  texts: string[];
  /** Numbers the screen's structured, sourced fields carry. */
  sourcedNumbers: number[];
}

export interface ApprovalEvent {
  askId: number;
  /** Version the founder was shown when they tapped (body hash) and what it said it would do. */
  shownHash: string | null;
  shownActs: { moveKind: string; domain: string } | null;
  answer: "yes" | "no";
  /** The ask row after the answer. */
  storedHash: string | null;
  storedActs: { moveKind: string; domain: string } | null;
  /** Dispatches the approval produced (idempotency key approved-ask:<id>). */
  dispatched: Array<{ sourceId: string }>;
}

export type HardStopKind = "pricing" | "legal_signing" | "spend_over_500" | "data_deletion";
export interface HardStopEvent {
  kind: HardStopKind;
  at: string;
  evidence: string;
  /** The founder tap that authorised it, if any (harness tap log). */
  founderTap: string | null;
}

export interface RefundEvent {
  id: string;
  at: string;
  amountCents: number;
  /** Executed by the machine (true) or by the founder's hand (false). */
  byMachine: boolean;
  /** The ceiling a machine refund must respect (the witness grant / tool ceiling), cents. */
  ceilingCents: number;
  /** Machine refunds executed under the grant so far, including this one, and the grant's max. */
  grantUsed: number;
  grantMax: number;
  /** Refund of a charge AcreOS made (subscription/credits) — never a customer's own money. */
  ofAcreosCharge: boolean;
}

export interface PageEvent {
  at: string;
  subject: string;
  body: string;
}
export interface OutageWindow {
  /** Ground truth from the harness: which provider was down, when. */
  provider: string;
  /** Words a page about this outage contains (e.g. "Stripe", "Email"). */
  names: string[];
  from: string;
  to: string | null;
}

export interface Observation {
  tick: number;
  at: string;
  queries?: QueryEvent[];
  tenantWrites?: TenantWriteEvent[];
  providerCalls?: ProviderCall[];
  /** Every counterparty address/number the world knows (leads, borrowers, sellers) across all orgs. */
  counterparties?: { emails: string[]; phones: string[] };
  /** The platform's own system-mail senders. */
  platformSenders?: string[];
  sends?: SendEvent[];
  screens?: ScreenEvent[];
  approvals?: ApprovalEvent[];
  hardStops?: HardStopEvent[];
  refunds?: RefundEvent[];
  pages?: PageEvent[];
  outages?: OutageWindow[];
  /** Sources the collector could not read this tick (counted as unknown). */
  unread?: string[];
}

export interface Violation {
  invariant: string;
  tick: number;
  at: string;
  evidence: string;
}
