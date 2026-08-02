/**
 * Founder-adjustable support-credit autonomy (founder decision, this session).
 *
 * Wave 1 hard-removed the support agent's ability to move platform money. The
 * founder wants to CONTROL that autonomy from the backend rather than have it
 * fixed. This exposes exactly one founder-only knob (`SUPPORT_CREDIT_AUTONOMY`,
 * registered in founderSettings' KNOBS, toggled from /founder/settings):
 *
 *   - "off" (default): the support AI can never touch credits — the request is
 *     refused and escalated to the founder/human. (Byte-identical to Wave 1.)
 *   - "propose": the AI still MOVES NO MONEY, but logs a founder-visible
 *     proposal for the founder to approve or decline out of band.
 *
 * Applying a credit is ALWAYS the founder's action — no setting lets the
 * customer-driven LLM move money (this preserves INV-MONEY / INV-HARD-1). The
 * customer and the LLM can never change this setting; only the founder can.
 */
import { getSetting } from "./founderSettings";

export const SUPPORT_CREDIT_AUTONOMY_KEY = "SUPPORT_CREDIT_AUTONOMY";

export type SupportCreditAutonomy = "off" | "propose";

/** Coerce a stored value to a level, failing safe to "off" for anything else. */
export function parseSupportCreditAutonomy(raw: string | null | undefined): SupportCreditAutonomy {
  return raw === "propose" ? "propose" : "off";
}

/** Read the current level (defaults to "off", and fails safe to "off" on error). */
export async function getSupportCreditAutonomy(): Promise<SupportCreditAutonomy> {
  try {
    return parseSupportCreditAutonomy(await getSetting(SUPPORT_CREDIT_AUTONOMY_KEY));
  } catch {
    return "off";
  }
}
