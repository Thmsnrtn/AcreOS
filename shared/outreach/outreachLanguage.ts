/**
 * The ONE rule for which language outreach to a landowner is written in.
 *
 * FAIR-HOUSING GUARD. A language chosen from an owner's name, surname, first
 * name or location is a national-origin proxy (Fair Housing Act, 42 U.S.C.
 * §3604; HUD treats language-based targeting as national-origin targeting).
 * So the language has exactly three lawful sources, in this order:
 *
 *   1. the OWNER said which language they want   (lead, source "owner_stated")
 *   2. the CUSTOMER chose it for this lead        (lead, source "customer_choice")
 *   3. the CUSTOMER chose it for this campaign    (campaign.language)
 *
 * and otherwise English. The input type below carries NO name, address,
 * county, state, ZIP or coordinate: there is nothing here an inference could
 * read. `outreachLanguageForLead` takes a whole lead row but reads only the
 * two language columns — tests/unit/outreachLanguageNoInference.test.ts proves
 * that with leads that differ only in name and place, and holds the population
 * of files allowed to WRITE the lead's language columns.
 *
 * A list vendor's "language" column is not one of these sources (vendors
 * commonly derive it from surname), so the importer never maps one.
 *
 * Pure; browser-safe.
 */

export const OUTREACH_LANGUAGES = ["en", "es"] as const;
export type OutreachLanguage = (typeof OUTREACH_LANGUAGES)[number];

export const OUTREACH_LANGUAGE_SOURCES = ["customer_choice", "owner_stated"] as const;
export type OutreachLanguageSource = (typeof OUTREACH_LANGUAGE_SOURCES)[number];

export const OUTREACH_LANGUAGE_LABELS: Readonly<Record<OutreachLanguage, string>> = {
  en: "English",
  es: "Español",
};

export const OUTREACH_LANGUAGE_SOURCE_LABELS: Readonly<Record<OutreachLanguageSource, string>> = {
  customer_choice: "You chose it",
  owner_stated: "The owner asked for it",
};

export function isOutreachLanguage(v: unknown): v is OutreachLanguage {
  return typeof v === "string" && (OUTREACH_LANGUAGES as readonly string[]).includes(v);
}

export function isOutreachLanguageSource(v: unknown): v is OutreachLanguageSource {
  return typeof v === "string" && (OUTREACH_LANGUAGE_SOURCES as readonly string[]).includes(v);
}

export type OutreachLanguageBasis = "owner_stated" | "customer_choice" | "campaign" | "default";

export interface OutreachLanguageInput {
  /** The lead's stored choice, with who made it. */
  lead?: { language: string | null | undefined; source: string | null | undefined } | null;
  /** The campaign's language, as the customer set it. */
  campaignLanguage?: string | null;
}

export interface OutreachLanguageVerdict {
  language: OutreachLanguage;
  basis: OutreachLanguageBasis;
}

function resolveOutreachLanguage(input: OutreachLanguageInput): OutreachLanguageVerdict {
  const lead = input.lead;
  if (lead && isOutreachLanguage(lead.language) && isOutreachLanguageSource(lead.source)) {
    // A stored language with no lawful source on it is not honoured.
    if (lead.source === "owner_stated") return { language: lead.language, basis: "owner_stated" };
  }
  if (lead && isOutreachLanguage(lead.language) && lead.source === "customer_choice") {
    return { language: lead.language, basis: "customer_choice" };
  }
  if (isOutreachLanguage(input.campaignLanguage)) {
    return { language: input.campaignLanguage, basis: "campaign" };
  }
  return { language: "en", basis: "default" };
}

/**
 * The lead-row adapter every server path uses. Reads ONLY the two language
 * columns of the row — whatever else the row carries (names, mailing address,
 * county, coordinates) is never looked at.
 */
export function outreachLanguageForLead(
  lead: { outreachLanguage?: string | null; outreachLanguageSource?: string | null } | null | undefined,
  campaign?: { language?: string | null } | null,
): OutreachLanguageVerdict {
  return resolveOutreachLanguage({
    lead: lead ? { language: lead.outreachLanguage, source: lead.outreachLanguageSource } : null,
    campaignLanguage: campaign?.language ?? null,
  });
}

/** How the customer sees the basis, in the language of the UI (English). */
export function describeOutreachLanguageBasis(v: OutreachLanguageVerdict): string {
  switch (v.basis) {
    case "owner_stated":
      return `${OUTREACH_LANGUAGE_LABELS[v.language]} — the owner asked for it`;
    case "customer_choice":
      return `${OUTREACH_LANGUAGE_LABELS[v.language]} — you chose it for this owner`;
    case "campaign":
      return `${OUTREACH_LANGUAGE_LABELS[v.language]} — the campaign's language`;
    default:
      return "English — no language has been chosen";
  }
}
