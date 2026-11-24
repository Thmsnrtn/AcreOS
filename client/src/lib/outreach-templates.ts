/**
 * The campaign composer's stock templates, served as data.
 *
 * The ONE registry stays shared/outreach/templates.ts — the server
 * (GET /api/direct-mail/templates) and the bilingual ethical-outreach
 * test import it synchronously. The client no longer bundles it: the
 * CAMPAIGN_TEMPLATES half ships as /outreach-templates.json (generated
 * verbatim from the module; tests/unit/staticDataServedAsData.test.ts
 * pins the asset deep-equal), and this module selects from the fetched
 * data with exactly campaignTemplatesFor's semantics — same language
 * fallback (unknown language → English), same unknown-channel → [].
 */

import type {
  CampaignChannel,
  CampaignTemplate,
} from "@shared/outreach/templates";
import type { OutreachLanguage } from "@shared/outreach/outreachLanguage";
import { OUTREACH_TEMPLATES_URL, useStaticData } from "@/lib/static-data";

export type CampaignTemplatesData = Record<
  OutreachLanguage,
  Record<CampaignChannel, CampaignTemplate[]>
>;

/** campaignTemplatesFor, over the served asset instead of the bundle. */
export function selectCampaignTemplates(
  data: CampaignTemplatesData,
  language: OutreachLanguage,
  channel: string,
): CampaignTemplate[] {
  const byChannel = data[language] ?? data.en;
  return (byChannel as Record<string, CampaignTemplate[]>)[channel] ?? [];
}

/**
 * The composer's templates for (language, channel): [] while the asset
 * is in flight or failed to load — the picker renders its shell first
 * and the templates arrive with the fetch (the BD-6 discipline).
 */
export function useCampaignTemplates(
  language: OutreachLanguage,
  channel: string,
): CampaignTemplate[] {
  const { data } = useStaticData<CampaignTemplatesData>(OUTREACH_TEMPLATES_URL);
  return data ? selectCampaignTemplates(data, language, channel) : [];
}
