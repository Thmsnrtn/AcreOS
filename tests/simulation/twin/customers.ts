/**
 * The twin's CUSTOMERS: who signs up, what they do each week, when friction
 * turns into a support ticket, and when they leave.
 *
 * Three personas (brief: the land flipper, the note investor, the VA-run
 * team). Tickets are generated FROM FRICTION THE REAL APP PRODUCED — the year
 * harness classifies each real response with the market's own
 * `classifyResponse` rubric and hands the class to `ticketFromFriction`; the
 * twin never invents a ticket out of thin air. Churn is a monthly hazard per
 * persona (assumption) moved by what the customer lived through: unresolved
 * tickets raise it, replies and deals lower it.
 */
import { Rng } from "./rng";
import { PARAMS } from "./parameters";

export type PersonaId = "land_flipper" | "note_investor" | "va_team";
export interface PersonaSpec {
  id: PersonaId;
  label: string;
  businessType: string;
  noteRole?: string;
  tier: "starter" | "pro" | "scale";
  /** Leads imported in week 1 (median; lognormal). */
  listSize: number;
  /** Touches per active week by channel (Poisson means). */
  weekly: { sms: number; email: number; mail: number; pax: number; pipeline: number; notes: number };
  vas: number;
}
export const PERSONAS: Record<PersonaId, PersonaSpec> = {
  land_flipper: { id: "land_flipper", label: "the land flipper", businessType: "land_flipper", tier: "pro", listSize: 300, weekly: { sms: 1, email: 0.5, mail: 1, pax: PARAMS.aiQuestionsPerActiveCustomerWeek.value, pipeline: 1, notes: 0 }, vas: 0 },
  note_investor: { id: "note_investor", label: "the note investor", businessType: "note_investor", noteRole: "invest", tier: "pro", listSize: 90, weekly: { sms: 0, email: 0.5, mail: 0.3, pax: PARAMS.aiQuestionsPerActiveCustomerWeek.value, pipeline: 0.5, notes: 1 }, vas: 0 },
  va_team: { id: "va_team", label: "the VA-run team", businessType: "land_flipper", tier: "scale", listSize: 450, weekly: { sms: 2, email: 1, mail: 1.5, pax: PARAMS.aiQuestionsPerActiveCustomerWeek.value * 2, pipeline: 2, notes: 0 }, vas: 2 },
};

export function drawPersona(rng: Rng): PersonaId {
  return rng.categorical(PARAMS.personaMix.value as Record<PersonaId, number>);
}

/** Cohort growth 3 → 25 → 100 over the year: target customer count by day. */
export function targetCustomers(day: number, plan: { at: Array<[number, number]> } = { at: [[0, 0], [30, 3], [180, 25], [365, 100]] }): number {
  const pts = plan.at;
  for (let i = 1; i < pts.length; i++) {
    const [d0, n0] = pts[i - 1], [d1, n1] = pts[i];
    if (day <= d1) return Math.round(n0 + ((n1 - n0) * (day - d0)) / (d1 - d0));
  }
  return pts[pts.length - 1][1];
}

export type FrictionClass = keyof typeof PARAMS.ticketPerFriction.value;
export interface Ticket { orgSlug: string; day: number; subject: string; body: string; friction: FrictionClass; evidence: string }

const SUBJECT: Record<FrictionClass, string[]> = {
  refusal_no_next_step: ["It won't let me do this", "Error with no explanation", "What does this mean?"],
  refusal_with_next_step: ["Quick question about a message I got", "Do I need to set something up?"],
  error_5xx: ["Something broke", "Getting an error", "Page crashed"],
  silent_noop: ["I sent it but nothing happened", "My campaign didn't go out?"],
  compliance_event: ["A seller says I texted them after they opted out", "Got a complaint from a seller"],
  manual_request: ["Please cancel my account", "Can you export my data?", "Change my plan please"],
};

/** A real friction event → maybe a ticket, worded by the customer. */
export function ticketFromFriction(rng: Rng, org: string, day: number, cls: FrictionClass, evidence: string): Ticket | null {
  const p = PARAMS.ticketPerFriction.value[cls];
  if (!rng.bernoulli(p)) return null;
  const subject = rng.pick(SUBJECT[cls]);
  return { orgSlug: org, day, subject, body: `${subject}. ${evidence.slice(0, 240)}`, friction: cls, evidence };
}

export interface MonthLived { unresolvedTickets: number; valueEvents: number }
/** Daily churn draw from the persona's monthly hazard, moved by the month lived. */
export function churnsToday(rng: Rng, persona: PersonaId, lived: MonthLived): boolean {
  const base = (PARAMS.baseMonthlyChurn.value as Record<PersonaId, number>)[persona];
  const mult = Math.max(0.2, 1 + PARAMS.churnPerUnresolvedTicket.value * lived.unresolvedTickets + PARAMS.churnPerValueEvent.value * lived.valueEvents);
  const monthly = Math.min(0.9, base * mult);
  const daily = 1 - Math.pow(1 - monthly, 1 / 30);
  return rng.bernoulli(daily);
}
