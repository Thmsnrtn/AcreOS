/**
 * The two cross-customer aggregates the design slots read (shared/forecasting/slots.ts).
 *
 * Both are deliberately cross-tenant and deliberately aggregate-only: the SQL
 * groups per organisation only so the pure floor functions can count distinct
 * organisations; nothing per-organisation leaves this module. The bypass is
 * the sanctioned, logged `unscopedForPlatformOps`.
 */
import { and, count, countDistinct, eq, gte, isNotNull, max, min, sql } from "drizzle-orm";
import { campaignDeliveryEvents, campaigns, customerOutcomeObservations, leads } from "@shared/schema";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { aggregateSaturation, countyForecastSlot, SATURATION_FLOORS, type CountySaturation, type CountySlot } from "@shared/forecasting/slots";
import { clock } from "../../utils/clock";

const REASON_SATURATION = "W4 mail saturation: per-county mail volume across customers, aggregate-only, org-count and volume floored (shared/forecasting/slots.ts)";
const REASON_COUNTY_SLOT = "W4 county forecast slot: per-county outcome counts across customers, aggregate-only (shared/forecasting/slots.ts)";

/** Counties with enough mail from enough customers to call "crowded"; the rest are absent. */
export async function mailSaturation(): Promise<CountySaturation[]> {
  const since = new Date(clock.nowMs() - SATURATION_FLOORS.windowDays * 86_400_000);
  const rows = await unscopedForPlatformOps(REASON_SATURATION)
    .select({ organizationId: campaigns.organizationId, state: leads.state, county: leads.county, pieces: count() })
    .from(campaignDeliveryEvents)
    .innerJoin(campaigns, eq(campaigns.id, campaignDeliveryEvents.campaignId))
    .innerJoin(leads, and(eq(leads.id, campaignDeliveryEvents.leadId), eq(leads.organizationId, campaigns.organizationId)))
    .where(and(eq(campaignDeliveryEvents.channel, "direct_mail"), gte(campaignDeliveryEvents.sentAt, since), isNotNull(leads.state), isNotNull(leads.county)))
    .groupBy(campaigns.organizationId, leads.state, leads.county);
  return aggregateSaturation(rows.map((r) => ({ organizationId: r.organizationId, state: r.state ?? "", county: r.county ?? "", pieces: Number(r.pieces) })));
}

/** Every county's forecast slot — "warming up" with what it has and needs, until the threshold is met. */
export async function countySlots(state?: string): Promise<CountySlot[]> {
  const rows = await unscopedForPlatformOps(REASON_COUNTY_SLOT)
    .select({
      state: customerOutcomeObservations.state,
      county: customerOutcomeObservations.county,
      outcomes: count(),
      orgs: countDistinct(customerOutcomeObservations.organizationId),
      first: min(customerOutcomeObservations.observedAt),
      last: max(customerOutcomeObservations.observedAt),
    })
    .from(customerOutcomeObservations)
    .where(
      and(
        isNotNull(customerOutcomeObservations.state),
        isNotNull(customerOutcomeObservations.county),
        state ? sql`upper(${customerOutcomeObservations.state}) = ${state.toUpperCase()}` : undefined,
      ),
    )
    .groupBy(customerOutcomeObservations.state, customerOutcomeObservations.county);
  return rows.map((r) =>
    countyForecastSlot({
      state: (r.state ?? "").toUpperCase(),
      county: r.county ?? "",
      outcomes: Number(r.outcomes),
      orgs: Number(r.orgs),
      firstObserved: r.first ? new Date(r.first).toISOString() : null,
      lastObserved: r.last ? new Date(r.last).toISOString() : null,
    }),
  );
}
