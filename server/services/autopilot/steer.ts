/**
 * Founder Autopilot — conversational steering ("talk to the company").
 *
 * The founder speaks in plain language and the system either ANSWERS from real
 * state ("why did you do that?", "how's growth?") or ADJUSTS ("focus on Texas",
 * "never email twice a week", "pause growth", "trust growth"). The intent
 * parser is PURE + deterministic (so it's exhaustively testable and never
 * "hallucinates" a command); the handlers act through the same governed
 * services everything else uses (standing orders, the Trust Ledger, the story).
 *
 * Honest by construction: a command it doesn't clearly recognize is `unknown`
 * (it asks for clarification) — it never guesses a destructive action.
 */
import type { AutopilotDomain } from "./policyGate";

export type SteerIntent =
  | { kind: "pause_domain"; domain: AutopilotDomain }
  | { kind: "trust_domain"; domain: AutopilotDomain }
  | { kind: "set_standing_order"; body: string }
  | { kind: "set_intent"; body: string }
  | { kind: "status"; domain?: AutopilotDomain }
  | { kind: "why" }
  | { kind: "unknown"; text: string };

const DOMAIN_WORDS: Array<[RegExp, AutopilotDomain]> = [
  [/\bgrowth\b/, "growth"],
  [/\bsupport\b/, "support"],
  [/\bdeploys?\b|\bengineering\b/, "deploy"],
  [/\bfinance\b|\bbudget\b|\brunway\b/, "finance"],
  [/\bops\b|\boperations\b/, "ops"],
];

function findDomain(text: string): AutopilotDomain | undefined {
  for (const [re, d] of DOMAIN_WORDS) if (re.test(text)) return d;
  return undefined;
}

/** Classify a natural-language steering command. Pure + total. */
export function parseSteerCommand(raw: string): SteerIntent {
  const text = raw.trim();
  const t = text.toLowerCase();
  if (!t) return { kind: "unknown", text };

  const domain = findDomain(t);

  // Pause / hold a domain (safety-first verbs).
  if (/\b(pause|stop|halt|hold|freeze)\b/.test(t) && domain && !/standing order|rule/.test(t)) {
    return { kind: "pause_domain", domain };
  }
  // Trust / let a domain act more.
  if (/\b(trust|let|allow|enable|unleash)\b/.test(t) && domain) {
    return { kind: "trust_domain", domain };
  }
  // Why / explain — read the reasoning trace.
  if (/\bwhy\b|\bexplain\b|\breasoning\b/.test(t)) {
    return { kind: "why" };
  }
  // Status / how's it going.
  if (/\bstatus\b|how('?s| is| are)\b|how are we\b|what('?s| is) (the|your) plan\b|what are you (working|doing)\b/.test(t)) {
    return { kind: "status", domain };
  }
  // Standing order — a durable rule (prohibitions / invariants).
  if (/^(never|always|do ?n'?t|do not)\b/.test(t) || /\bnever\b|\balways\b/.test(t)) {
    return { kind: "set_standing_order", body: text };
  }
  // Intent — a north-star goal / focus.
  if (/^(focus on|prioriti[sz]e|aim (to|for)|target|our goal|i want|let'?s|go after)\b/.test(t)) {
    return { kind: "set_intent", body: text };
  }
  return { kind: "unknown", text };
}

// ── Handlers (act through governed services) ─────────────────────────────────

export interface SteerResult {
  reply: string;
  /** A machine-readable description of any change made (for logs/UI). */
  action?: { kind: SteerIntent["kind"]; detail: string };
}

export interface SteerDeps {
  setDomainLevel: (domain: AutopilotDomain, level: string, reason: string) => Promise<unknown>;
  getDomainLevel: (domain: AutopilotDomain) => Promise<string>;
  nextLevel: (level: string) => string | null;
  createStandingOrder: (input: { kind: "intent" | "standing_order"; body: string; createdBy?: string }) => Promise<unknown>;
  status: (domain?: AutopilotDomain) => Promise<string>;
  why: () => Promise<string>;
}

const LEVEL_LABEL: Record<string, string> = {
  observe: "observing",
  draft: "drafting for your approval",
  execute_gated: "acting (gated)",
  autonomous_gated: "trusted to act",
};

/** Execute a parsed steering intent. Never throws — returns a reply either way. */
export async function handleSteer(intent: SteerIntent, deps: SteerDeps, founderId?: string): Promise<SteerResult> {
  try {
    switch (intent.kind) {
      case "pause_domain":
        await deps.setDomainLevel(intent.domain, "observe", "paused by founder (chat)");
        return {
          reply: `Done — ${intent.domain} is paused. It's back to observing and won't act until you trust it again.`,
          action: { kind: intent.kind, detail: `${intent.domain} → observe` },
        };
      case "trust_domain": {
        const current = await deps.getDomainLevel(intent.domain);
        const next = deps.nextLevel(current);
        if (!next) {
          return { reply: `${intent.domain} is already at full autonomy — nothing more to grant.` };
        }
        await deps.setDomainLevel(intent.domain, next, "trust granted by founder (chat)");
        return {
          reply: `Done — ${intent.domain} is now ${LEVEL_LABEL[next] ?? next}. You can pause it anytime.`,
          action: { kind: intent.kind, detail: `${intent.domain} → ${next}` },
        };
      }
      case "set_standing_order":
        await deps.createStandingOrder({ kind: "standing_order", body: intent.body, createdBy: founderId });
        return {
          reply: `Got it — I'll honor that as a standing rule from now on: "${intent.body}". You can remove it on the Your Voice page.`,
          action: { kind: intent.kind, detail: intent.body },
        };
      case "set_intent":
        await deps.createStandingOrder({ kind: "intent", body: intent.body, createdBy: founderId });
        return {
          reply: `Understood — I'll steer toward that: "${intent.body}".`,
          action: { kind: intent.kind, detail: intent.body },
        };
      case "status":
        return { reply: await deps.status(intent.domain) };
      case "why":
        return { reply: await deps.why() };
      case "unknown":
        return {
          reply:
            "I can set an intent or a standing order, pause or trust a domain, or tell you status + why. Try \"pause growth\", \"focus on Texas\", \"never email twice a week\", or \"why did you do that?\".",
        };
    }
  } catch {
    return { reply: "I couldn't carry that out just now — please try again in a moment." };
  }
}
