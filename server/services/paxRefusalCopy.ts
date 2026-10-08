/**
 * What the customer reads when the constitutional pre-call screener refuses a
 * Pax request.
 *
 * The screener's DECISION is untouched — this module only words it. Before,
 * the customer received "This request was refused by the constitutional
 * pre-call check." and nothing else (oracle pass I3, I5): no reason, no safe
 * alternative, and on the streaming route not even that, because the refusal
 * went out as an SSE `event: error` frame the chat client does not read.
 *
 * Every message says, in plain words, WHAT Pax will not do and WHY, then
 * offers the nearest thing it CAN do. Where the alternative involves a count
 * ("I can text only the 4 leads who did"), the count is read from the org's
 * own leads, never estimated.
 */
import { customerImmutableByNumber } from "@sovereign/immutables";

export type RefusalKind = "consent_bypass_send" | "cross_tenant_data" | "generic";

export interface RefusalInput {
  immutableNumber: number | null | undefined;
  promptText: string;
}

const SEND_VERB = /\b(text|texts|texting|sms|message|messages|email|emails|e-mail|mail|send|blast|call)\b/i;
const CONSENT_BYPASS =
  /\b(consent|tcpa|opt(?:ed)?[- ]?out|do[- ]not[- ]contact|dnc|unsubscribe[sd]?|skip (?:the )?(?:check|compliance)|bypass|ignore (?:the )?(?:check|rules?))\b/i;
const OTHER_TENANTS =
  /\b(every|all|other|another|any)\s+(?:\w+\s+)?(organi[sz]ations?|orgs?|accounts?|customers?|tenants?|companies|users?)\b/i;

function channelOf(prompt: string): "text" | "email" {
  return /\b(email|emails|e-mail)\b/i.test(prompt) && !/\b(text|texts|texting|sms)\b/i.test(prompt) ? "email" : "text";
}

/** Which refusal this is, from the screener's immutable and the request itself. */
function classifyRefusal(input: RefusalInput): RefusalKind {
  const p = String(input.promptText ?? "");
  if (OTHER_TENANTS.test(p) || (input.immutableNumber === 5 && /\b(organi[sz]ation|tenant|customer)/i.test(p))) {
    return "cross_tenant_data";
  }
  if (SEND_VERB.test(p) && (CONSENT_BYPASS.test(p) || /\ball (?:of )?my leads\b|\beveryone\b|\bmy whole list\b/i.test(p))) {
    return "consent_bypass_send";
  }
  return "generic";
}

export interface RefusalDeps {
  /** Leads Pax may lawfully contact on `channel`: consent on file (texts), not do-not-contact, reachable. */
  countContactableLeads: (organizationId: number, channel: "text" | "email") => Promise<number>;
}

export interface CustomerRefusal {
  kind: RefusalKind;
  message: string;
}

export async function customerRefusalMessage(
  organizationId: number,
  input: RefusalInput,
  deps: RefusalDeps,
): Promise<CustomerRefusal> {
  const kind = classifyRefusal(input);

  if (kind === "consent_bypass_send") {
    const channel = channelOf(input.promptText);
    let n: number | null = null;
    try {
      n = await deps.countContactableLeads(organizationId, channel);
    } catch {
      n = null;
    }
    const noun = channel === "text" ? "text" : "email";
    const who = "leads who haven't given consent or who are on do-not-contact";
    const why =
      channel === "text"
        ? "Marketing texts without a lead's prior written consent break the TCPA, and the fines land on you, per message."
        : "AcreOS emails a lead only with consent on file and never one on do-not-contact; that protects you under CAN-SPAM and keeps your sender reputation.";
    if (n === null) {
      return {
        kind,
        message:
          `I can't ${noun} ${who}. ${why} I can ${noun} only the leads who did give consent — ` +
          `want me to look up who that is and draft the message? Nothing goes out until you approve it.`,
      };
    }
    if (n === 0) {
      return {
        kind,
        message:
          `I can't ${noun} ${who}. ${why} Right now none of your leads has consent on file and is clear of do-not-contact, ` +
          `so there is no one I can ${noun}. You can record consent on a lead's page (Deals → Leads → the lead), ` +
          `and then I can draft ${noun}s for those leads.`,
      };
    }
    return {
      kind,
      message:
        `I can't ${noun} ${who}. ${why} I can ${noun} only the ${n} lead${n === 1 ? "" : "s"} who did ` +
        `(consent on file, not on do-not-contact). Want that? I'll draft it and nothing goes out until you approve it.`,
    };
  }

  if (kind === "cross_tenant_data") {
    return {
      kind,
      message:
        "I can only see and use your own organization's data — never another customer's, and I won't try. " +
        "I can list your own leads (with their phone numbers) instead. Want that?",
    };
  }

  const rule = input.immutableNumber ? customerImmutableByNumber(input.immutableNumber) : undefined;
  return {
    kind,
    message:
      (rule
        ? `I can't help with that request: it goes against a rule I always follow — "${rule.text}" `
        : "I can't help with that request as asked. ") +
      "Tell me what you're trying to get done and I'll suggest a way to do it that I can help with.",
  };
}
