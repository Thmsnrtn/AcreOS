/**
 * How the twin's owners and carriers respond to a send.
 *
 * Delivery is decided by the provider failure modes (A2P registration,
 * landlines, carrier filtering, bounces, undeliverable mail). Replies are drawn
 * from the market reply mix (PARAMS, source market/) and WORDED by a generator
 * that composes phrasings from parts — so the product's opt-out detector meets
 * wordings nobody tuned it against. Every generated reply carries its GROUND
 * TRUTH (`revokesConsent`), which is what the compliance invariant checks, not
 * the product's own reading of the text.
 */
import { Rng, hashSeed } from "./rng";
import { PARAMS } from "./parameters";
import type { Owner } from "./world";

export type ReplyKind = "stop" | "natural-optout" | "wrong-number" | "interested" | "angry";
export interface Reply { kind: ReplyKind; text: string; revokesConsent: boolean; delayHours: number }

const OPT_LEAD = ["", "Please ", "Pls ", "Hey, ", "Look, ", "I said ", "For the last time, ", "Ok ", "Sir, ", "Ma'am "];
const OPT_CORE = [
  "stop texting me", "stop messaging me", "don't text me again", "do not contact me", "remove me from your list",
  "take me off your list", "unsubscribe me", "lose this number", "delete my number", "quit texting me",
  "never contact me again", "no more texts", "stop sending these", "leave me alone and stop texting",
  "remove my number", "take my number off", "stop contacting me", "don't message this number", "opt me out", "cease all contact",
];
const OPT_TAIL = ["", ".", "!", " thanks", " or I'll report you", ". This is harassment.", " immediately", " now", " asap", "!!"];
const STOP_WORDS = ["STOP", "Stop", "stop", "STOP.", "UNSUBSCRIBE", "unsubscribe", "Cancel", "END", "QUIT", "STOPALL", "stop please", "STOP!!"];
const WRONG = ["Wrong number", "You have the wrong person", "I don't own any land", "This isn't {first}", "{first} passed away last year", "Not me, wrong #", "new number, who is this", "Never heard of {first}"];
const INTERESTED = ["Maybe, what's your offer?", "How much for the {acres} acres?", "Call me after 5", "I'd sell for the right price", "Yes, interested", "What county is this about?", "Send me an offer in writing"];
const ANGRY = ["Not selling.", "Scam", "How did you get my number?", "Not interested", "Why do you people keep bugging me", "No"];

/** Every NL opt-out wording the generator can produce (lead × core × tail). */
export function allOptOutWordings(): string[] {
  const out: string[] = [];
  for (const l of OPT_LEAD) for (const c of OPT_CORE) for (const t of OPT_TAIL) out.push(cap(l + c) + t);
  return out;
}
function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Held-out split by a hash of the wording (30%). Guards and detectors are
 * TUNED only on the working set; scorecards report the held-out set.
 */
export function isHeldOut(text: string): boolean {
  return ((hashSeed(`heldout:${text}`) >>> 0) % 10) < 3;
}

function fill(t: string, o: Owner, acres = 5): string {
  return t.replace("{first}", o.first).replace("{acres}", String(acres));
}

export function smsReply(rng: Rng, o: Owner, acres = 5): Reply | null {
  if (!rng.bernoulli(PARAMS.smsReplyRate.value)) return null;
  const delayHours = Math.max(0.05, rng.lognormal(PARAMS.smsReplyLatencyHoursMedian.value, 1));
  if (o.phoneWrongPerson) {
    // Wrong person: wrong-number replies dominate; some just say STOP.
    if (rng.bernoulli(0.7)) return { kind: "wrong-number", text: fill(rng.pick(WRONG), o, acres), revokesConsent: true, delayHours };
    return { kind: "stop", text: rng.pick(STOP_WORDS), revokesConsent: true, delayHours };
  }
  const kind = rng.categorical<ReplyKind>({
    stop: PARAMS.smsReplyShareStop.value,
    "natural-optout": PARAMS.smsReplyShareNaturalOptOut.value * (0.5 + o.irritability),
    "wrong-number": PARAMS.smsReplyShareWrongNumber.value * 0.3,
    interested: PARAMS.smsReplyShareInterested.value * (0.5 + o.motivation * 1.5),
    angry: PARAMS.smsReplyShareAngry.value,
  });
  switch (kind) {
    case "stop": return { kind, text: rng.pick(STOP_WORDS), revokesConsent: true, delayHours };
    case "natural-optout": return { kind, text: cap(rng.pick(OPT_LEAD) + rng.pick(OPT_CORE)) + rng.pick(OPT_TAIL), revokesConsent: true, delayHours };
    // A wrong-number reply revokes consent for that number (the FCC treats it
    // as a reasonable revocation; the product's own detector says so too).
    case "wrong-number": return { kind, text: fill(rng.pick(WRONG), o, acres), revokesConsent: true, delayHours };
    case "interested": return { kind, text: fill(rng.pick(INTERESTED), o, acres), revokesConsent: false, delayHours };
    case "angry": return { kind, text: rng.pick(ANGRY), revokesConsent: false, delayHours };
  }
}

export type SmsOutcome = { delivered: true } | { delivered: false; code: number; reason: string };
export function smsDelivery(rng: Rng, o: Owner, senderRegistered: boolean): SmsOutcome {
  const codes = PARAMS.twilioErrorCodes.value;
  if (!senderRegistered && rng.bernoulli(PARAMS.a2pUnregisteredBlockedShare.value)) return { delivered: false, code: codes.unregistered10dlc, reason: "unregistered 10DLC" };
  if (!o.phone) return { delivered: false, code: codes.unknownDestination, reason: "no phone" };
  if (o.phoneKind === "landline") return { delivered: false, code: codes.landline, reason: "landline" };
  if (rng.bernoulli(PARAMS.carrierFilterRate.value)) return { delivered: false, code: codes.filtered, reason: "carrier filtered" };
  return { delivered: true };
}

export type EmailOutcome = { delivered: boolean; bounced: boolean; complained: boolean; replied: boolean };
export function emailOutcome(rng: Rng, o: Owner): EmailOutcome {
  if (!o.email || o.emailBounces) return { delivered: false, bounced: true, complained: false, replied: false };
  return { delivered: true, bounced: false, complained: rng.bernoulli(PARAMS.emailComplaint.value), replied: rng.bernoulli(PARAMS.emailReplyRate.value) };
}

export type MailOutcome = { delivered: boolean; reason?: string; callback: boolean };
export function mailOutcome(rng: Rng, o: Owner): MailOutcome {
  if (rng.bernoulli(PARAMS.lobAddressInvalid.value)) return { delivered: false, reason: "address rejected", callback: false };
  if (o.mailUndeliverable) return { delivered: false, reason: "undeliverable as addressed", callback: false };
  return { delivered: true, callback: rng.bernoulli(PARAMS.mailCallbackRate.value * (0.5 + o.motivation)) };
}
