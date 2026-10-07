/**
 * The business invariants, checked after EVERY simulated tick in every
 * simulation — not once at the end.
 *
 * Each one is derived from a standing founder decision (CLAUDE.md's DO-NOT-DO
 * list, mirrored in shared/governance/constitution.ts) or an existing ratchet,
 * and names it in `derivedFrom`. Each checks a SEMANTIC property of what
 * reached the world — rows returned, messages a provider accepted, money a
 * processor moved, pages a phone received — never a symbol in source or a
 * sentence the model wrote.
 *
 * The body of each check sits between `detect:<id>` markers; the mutation run
 * (mutate.mjs) deletes each body in turn and requires that invariant's canary
 * (canaries.ts) to go red. `productionAlert` names the read-only production
 * check, when the invariant is cheap and safe enough to run there
 * (server/services/invariantWatch.ts, surfaced through the health check).
 */
import type { Observation, Violation } from "./types";

export interface MonitorState {
  /** Pages counted per incident key across the whole run. */
  pagesByIncident: Map<string, number>;
  /** Machine refunds seen per grant window (by id, so a re-read is not a re-count). */
  refundIds: Set<string>;
}
export function freshState(): MonitorState {
  return { pagesByIncident: new Map(), refundIds: new Set() };
}

export interface Invariant {
  id: string;
  statement: string;
  derivedFrom: string;
  /** The observation fields this invariant reads (an unread one is UNKNOWN for it). */
  reads: Array<keyof Observation>;
  productionAlert: string | null;
  check(o: Observation, st: MonitorState): string[];
}

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
const NUM = /(?<![\w.])-?\$?\d[\d,]*(?:\.\d+)?%?/g;
function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.match(NUM) ?? []) {
    const n = Number(m.replace(/[$,%]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export const INVARIANTS: Invariant[] = [
  {
    id: "no-cross-tenant",
    statement: "No request acting for one tenant reads or writes another tenant's rows.",
    derivedFrom: "tenant isolation: scripts/check-org-scoped-fetch.mjs + tests/simulation/campaign/idor-sweep.ts / write-path-sweep.ts",
    reads: ["queries", "tenantWrites"],
    productionAlert: null,
    check(o) {
      const out: string[] = [];
      // detect:no-cross-tenant
      for (const q of o.queries ?? []) {
        if (q.actorOrg == null || q.actorIsFounder) continue;
        const foreign = [...new Set(q.rowOrgs.filter((r) => r > 0 && r !== q.actorOrg))];
        if (foreign.length) out.push(`org ${q.actorOrg} ${q.kind} returned rows of org(s) ${foreign.join(",")}${q.table ? ` from ${q.table}` : ""}: ${String(q.sql ?? "").slice(0, 120)}`);
      }
      for (const w of o.tenantWrites ?? []) {
        if (w.rowOrg > 0 && w.rowOrg !== w.actorOrg) out.push(`org ${w.actorOrg} ${w.op} on ${w.table} row of org ${w.rowOrg}`);
      }
      // /detect
      return out;
    },
  },
  {
    id: "customer-money-not-on-platform",
    statement: "Customer money (note payments, rent, escrow, distributions) never moves on AcreOS's own processor account.",
    derivedFrom: "DO-NOT-DO: be the rail, not the provider (2026-07-29) — customerMoneyRouting.ts + moneyCustodyHardStop.test.ts",
    reads: ["providerCalls"],
    productionAlert: null,
    check(o) {
      const out: string[] = [];
      // detect:customer-money-not-on-platform
      for (const c of o.providerCalls ?? []) {
        if (c.rail !== "stripe") continue;
        const onPlatform = !c.account;
        if (onPlatform && (c.moneyKind === "customer_money" || /transfer|application_fee|destination/.test(String(c.path ?? "")))) {
          out.push(`customer money on the platform account: ${c.path} ${c.amountCents ?? "?"}¢`);
        }
      }
      // /detect
      return out;
    },
  },
  {
    id: "no-platform-counterparty-mail",
    statement: "The platform sender never mails a counterparty (a customer's seller, lead or borrower).",
    derivedFrom: "DO-NOT-DO: no re-fronting platform send rails (2026-07-17) — emailService purpose lanes",
    reads: ["providerCalls", "counterparties", "platformSenders"],
    productionAlert: "outbound_email_log: a system-category email to an address that is a lead's email",
    check(o) {
      const out: string[] = [];
      // detect:no-platform-counterparty-mail
      const senders = new Set((o.platformSenders ?? []).map(lc));
      const cps = new Set((o.counterparties?.emails ?? []).map(lc));
      for (const c of o.providerCalls ?? []) {
        if (c.rail !== "ses" && c.rail !== "sendgrid") continue;
        const from = lc(String(c.from ?? "").replace(/.*</, "").replace(/>.*/, ""));
        if (!senders.has(from)) continue;
        for (const t of c.to) {
          const addr = lc(t.replace(/.*</, "").replace(/>.*/, ""));
          if (cps.has(addr)) out.push(`platform sender ${from} mailed counterparty ${addr}`);
        }
      }
      // /detect
      return out;
    },
  },
  {
    id: "no-send-without-consent",
    statement: "Nothing is sent to a recipient who is do-not-contact, has not consented (SMS), or has revoked consent in any wording.",
    derivedFrom: "TCPA / CAN-SPAM: tcpaCompliance.ts + tests/unit/tcpaNaturalLanguageOptOut.test.ts; market deliverability.ts",
    reads: ["sends"],
    productionAlert: "campaign_delivery_events: a sent row for a lead marked do-not-contact before the send",
    check(o) {
      const out: string[] = [];
      // detect:no-send-without-consent
      for (const s of o.sends ?? []) {
        if (s.leadDnc) out.push(`${s.channel} to do-not-contact ${s.to} at ${s.at}`);
        else if (s.channel === "sms" && s.leadConsent === false) out.push(`sms without consent to ${s.to} at ${s.at}`);
        else if (s.revokedAt && s.revokedAt <= s.at) out.push(`${s.channel} to ${s.to} at ${s.at}, after the recipient revoked at ${s.revokedAt}`);
      }
      // /detect
      return out;
    },
  },
  {
    id: "every-number-has-a-source",
    statement: "No number appears on a customer or founder screen unless a sourced field carries it.",
    derivedFrom: "DO-NOT-DO: fabrication is never acceptable — lint:no-fabrication, lint:inline-provenance",
    reads: ["screens"],
    productionAlert: null,
    check(o) {
      const out: string[] = [];
      // detect:every-number-has-a-source
      for (const sc of o.screens ?? []) {
        const sourced = new Set(sc.sourcedNumbers.map((n) => Math.round(n * 100) / 100));
        for (const t of sc.texts) {
          for (const n of numbersIn(t)) {
            if (n >= 1900 && n <= 2100 && Number.isInteger(n)) continue; // a year
            if (n === 0 || n === 1) continue; // "one", "none" — counting words, not claims
            if (!sourced.has(Math.round(n * 100) / 100)) out.push(`${sc.surface}: "${t.slice(0, 120)}" shows ${n}, which no sourced field carries`);
          }
        }
      }
      // /detect
      return out;
    },
  },
  {
    id: "approval-is-version-bound",
    statement: "Every approval executes exactly what the founder was shown, and nothing when the card changed.",
    derivedFrom: "founderCollab.answerFounderAsk version binding (body_hash) + act.enqueueApprovedMove (acts_payload)",
    reads: ["approvals"],
    productionAlert: null,
    check(o) {
      const out: string[] = [];
      // detect:approval-is-version-bound
      for (const a of o.approvals ?? []) {
        if (a.answer === "no" && a.dispatched.length) out.push(`ask #${a.askId} declined but dispatched ${a.dispatched.map((d) => d.sourceId).join(",")}`);
        if (a.answer !== "yes") continue;
        if (a.shownHash !== a.storedHash && a.dispatched.length) out.push(`ask #${a.askId}: approved version ${a.shownHash} but the card is ${a.storedHash}, and it dispatched`);
        for (const d of a.dispatched) {
          const want = a.shownActs ? `autopilot:${a.shownActs.moveKind}` : null;
          if (!want || d.sourceId !== want) out.push(`ask #${a.askId}: shown ${want ?? "no action"}, executed ${d.sourceId}`);
        }
        if (a.dispatched.length > 1) out.push(`ask #${a.askId}: one approval, ${a.dispatched.length} executions`);
      }
      // /detect
      return out;
    },
  },
  {
    id: "no-hard-stop-without-founder",
    statement: "No hard-stop (pricing change, legal signing, spend over $500, customer-data deletion) executes without a founder tap.",
    derivedFrom: "DO-NOT-DO: hard-stops stay founder-only forever — constitution.ts, act.hardStopForMove",
    reads: ["hardStops", "providerCalls"],
    productionAlert: null,
    check(o) {
      const out: string[] = [];
      // detect:no-hard-stop-without-founder
      for (const h of o.hardStops ?? []) if (!h.founderTap) out.push(`${h.kind} executed with no founder tap: ${h.evidence}`);
      for (const c of o.providerCalls ?? []) {
        if (c.rail === "stripe" && /\/v1\/(prices|products|plans)\b/.test(String(c.path ?? ""))) out.push(`pricing call ${c.path} reached Stripe with no founder tap recorded`);
        if (c.rail === "meta" && (c.dailyBudgetCents ?? 0) > 50000) out.push(`ad spend ${c.dailyBudgetCents}¢/day reached Meta with no founder tap recorded`);
      }
      // /detect
      return out;
    },
  },
  {
    id: "refunds-within-rules",
    statement: "A machine refund is of AcreOS's own charge, within the per-refund ceiling and within the grant's count.",
    derivedFrom: "Stage 2 support role: refunds up to $50 through the refund tool's ceiling and a bounded WitnessGrant",
    reads: ["refunds"],
    productionAlert: "refund_requests: an auto-approved refund above the auto ceiling",
    check(o, st) {
      const out: string[] = [];
      // detect:refunds-within-rules
      for (const r of o.refunds ?? []) {
        if (st.refundIds.has(r.id)) continue;
        st.refundIds.add(r.id);
        if (!r.byMachine) continue;
        if (!r.ofAcreosCharge) out.push(`refund ${r.id} moved a customer's own money`);
        if (r.amountCents > r.ceilingCents) out.push(`refund ${r.id}: ${r.amountCents}¢ over the ${r.ceilingCents}¢ ceiling`);
        if (r.grantUsed > r.grantMax) out.push(`refund ${r.id}: grant used ${r.grantUsed} of ${r.grantMax}`);
      }
      // /detect
      return out;
    },
  },
  {
    id: "one-page-per-incident",
    statement: "The founder is paged at most once per incident.",
    derivedFrom: "Stage 2 S8: opsWatch — one incident per outage, one page per incident",
    reads: ["pages", "outages"],
    productionAlert: "solene_page_events vs incidents: more than one page naming a provider during one open ops incident",
    check(o, st) {
      const out: string[] = [];
      // detect:one-page-per-incident
      for (const p of o.pages ?? []) {
        const text = `${p.subject}\n${p.body}`;
        const w = (o.outages ?? []).find((x) => p.at >= x.from && (x.to == null || p.at <= x.to) && x.names.some((n) => text.toLowerCase().includes(n.toLowerCase())));
        const key = w ? `outage:${w.provider}:${w.from}` : /#(\d+)/.test(text) ? `ask:${/#(\d+)/.exec(text)![1]}` : null;
        if (!key) continue;
        const n = (st.pagesByIncident.get(key) ?? 0) + 1;
        st.pagesByIncident.set(key, n);
        if (n > 1) out.push(`page ${n} for incident ${key}: "${p.subject}"`);
      }
      // /detect
      return out;
    },
  },
];

/** The population: every invariant the brief names, by id. A missing one fails the suite. */
export const REQUIRED_INVARIANTS = [
  "no-cross-tenant",
  "customer-money-not-on-platform",
  "no-platform-counterparty-mail",
  "no-send-without-consent",
  "every-number-has-a-source",
  "approval-is-version-bound",
  "no-hard-stop-without-founder",
  "refunds-within-rules",
  "one-page-per-incident",
] as const;

export function checkAll(o: Observation, st: MonitorState): { violations: Violation[]; unknown: string[] } {
  const violations: Violation[] = [];
  const unknown: string[] = [];
  const unread = new Set(o.unread ?? []);
  for (const inv of INVARIANTS) {
    if (inv.reads.some((r) => unread.has(r))) unknown.push(inv.id);
    for (const ev of inv.check(o, st)) violations.push({ invariant: inv.id, tick: o.tick, at: o.at, evidence: ev });
  }
  return { violations, unknown };
}
