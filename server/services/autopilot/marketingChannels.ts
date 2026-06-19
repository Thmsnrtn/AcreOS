/**
 * Founder Autopilot — autonomous marketing channels (the self-marketing brain).
 *
 * The autopilot doesn't need the founder to run marketing; it markets ITSELF.
 * This is the capability that lets it reason about marketing *channels* the way
 * a CMO does — which tools/channels exist, which are FREE vs PAID, which are
 * available right now, and the discipline of WHEN to use each:
 *
 *   FREE FIRST  — owned content (county guides, field-notes), the programmatic
 *                 parcel-report SEO surface, and the embeddable free tools as a
 *                 backlink/distribution surface. These run continuously (gated
 *                 only by publish-enabled) and cost ~$0. The snowball.
 *   PAID WHEN THE TIME IS RIGHT — ad spend unlocks ONLY when three things are
 *                 true together: a real ad provider is wired, the growth domain
 *                 has EARNED paid-spend autonomy, AND the free funnel has PROVEN
 *                 it converts (real attributed signups → healthy CAC). You don't
 *                 pour money into a funnel you haven't proven; you amplify one
 *                 you have.
 *
 * Pure selection logic → exhaustively unit-testable. It decides WHICH channels
 * the autopilot may act on now; the existing growthEngine decides which owned
 * content PLAY to run, and the hands (publishArtifact / run_ad_campaign) do the
 * acting, all behind the same gates + witnessed-send.
 */

export type ChannelKind = "owned_content" | "seo_funnel" | "distribution" | "outbound" | "paid";
export type CostClass = "free" | "paid";

export interface MarketingChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  costClass: CostClass;
  /** The hand/play the autopilot uses to act on this channel. */
  via: string;
  /** True if acting needs domain autonomy beyond the default gates (e.g. spend). */
  requiresEarnedAutonomy: boolean;
  /** What acting on this channel does. */
  brief: string;
}

/** The catalog the autopilot reasons over. Free channels first (the snowball);
 * paid last (amplification). Availability is decided at selection time. */
export const MARKETING_CHANNELS: readonly MarketingChannel[] = [
  {
    id: "owned_county_guides",
    name: "Programmatic county guides (SEO)",
    kind: "owned_content",
    costClass: "free",
    via: "growthPlaybook:county-guide → publishArtifact",
    requiresEarnedAutonomy: false,
    brief: "Draft + publish the best free reference for a county's land — compounding inbound SEO at ~$0.",
  },
  {
    id: "owned_field_notes",
    name: "Field-notes content rail",
    kind: "owned_content",
    costClass: "free",
    via: "growthPlaybook → publishArtifact (/field-notes)",
    requiresEarnedAutonomy: false,
    brief: "Publish genuinely-useful land-investing explainers to the owned /field-notes rail.",
  },
  {
    id: "parcel_report_seo",
    name: "Programmatic parcel-report pages",
    kind: "seo_funnel",
    costClass: "free",
    via: "public parcel-check → /p/:state/:county/:apn",
    requiresEarnedAutonomy: false,
    brief: "Every free parcel check mints an indexable public report page — infinite SEO inventory that doubles as the data co-op intake.",
  },
  {
    id: "embeddable_tools",
    name: "Embeddable free tools (backlinks)",
    kind: "distribution",
    costClass: "free",
    via: "/tools/*/embed + EmbedToolCard",
    requiresEarnedAutonomy: false,
    brief: "Promote the embeddable parcel-check / calculator so others place them — backlinks + referral traffic at $0.",
  },
  {
    id: "witnessed_outbound",
    name: "Witnessed outbound (re-engage intent)",
    kind: "outbound",
    costClass: "free",
    via: "send_email (witnessed)",
    requiresEarnedAutonomy: true,
    brief: "Re-engage someone who showed real intent (ran a parcel check, stalled trial) — drafted, founder-witnessed, no cold spam.",
  },
  {
    id: "paid_ads",
    name: "Paid amplification (Meta/TikTok)",
    kind: "paid",
    costClass: "paid",
    via: "run_ad_campaign (witnessed, budget-capped)",
    requiresEarnedAutonomy: true,
    brief: "Amplify the content that ALREADY converts — only once free has proven the funnel + CAC is healthy.",
  },
];

export interface MarketingState {
  /** Owned-content publish switch (Control Center). Gates every free content channel. */
  publishEnabled: boolean;
  /** Real signups attributed to owned content — proof the free funnel converts. */
  attributedSignups: number;
  /** Whether the growth domain has EARNED autonomy for spend/outbound. */
  growthAutonomyEarned: boolean;
  /** A real ad provider is wired (adProvider) — else paid is dormant by absence. */
  paidProviderAvailable: boolean;
  /** economics.shouldRampBudget: healthy CAC proven from real attributed conversion. */
  cacProven: boolean;
}

/** Attributed signups below which the free funnel is NOT yet proven (don't pay). */
export const FUNNEL_PROVEN_MIN_SIGNUPS = 5;

export interface ChannelDecision {
  channel: MarketingChannel;
  eligible: boolean;
  reason: string;
}

/**
 * The CMO discipline, encoded. Returns every channel with an eligibility verdict
 * + reason, in priority order (free first). Pure.
 *
 * Free content/SEO/distribution: eligible once publish is on.
 * Witnessed outbound: eligible once growth autonomy is earned (still witnessed).
 * Paid: eligible ONLY when provider wired AND autonomy earned AND the free funnel
 *       has proven it converts (attributed signups ≥ threshold) AND CAC is healthy.
 */
export function evaluateMarketingChannels(state: MarketingState): ChannelDecision[] {
  const funnelProven = state.attributedSignups >= FUNNEL_PROVEN_MIN_SIGNUPS && state.cacProven;
  return MARKETING_CHANNELS.map((channel) => {
    if (channel.costClass === "free" && channel.kind !== "outbound") {
      return state.publishEnabled
        ? { channel, eligible: true, reason: "free owned channel — run continuously (the snowball)" }
        : { channel, eligible: false, reason: "publish switch is off — flip it in the Control Center to start free content" };
    }
    if (channel.kind === "outbound") {
      return state.growthAutonomyEarned
        ? { channel, eligible: true, reason: "growth autonomy earned — witnessed outbound to real-intent contacts" }
        : { channel, eligible: false, reason: "growth domain has not yet earned outbound autonomy" };
    }
    // Paid — the "when the time is right" gate.
    if (!state.paidProviderAvailable) return { channel, eligible: false, reason: "no ad provider wired — paid is dormant by absence" };
    if (!state.growthAutonomyEarned) return { channel, eligible: false, reason: "growth domain has not earned paid-spend autonomy" };
    if (!funnelProven) return { channel, eligible: false, reason: `free funnel not yet proven (${state.attributedSignups}/${FUNNEL_PROVEN_MIN_SIGNUPS} attributed signups + healthy CAC) — don't pay to fill a funnel you haven't proven` };
    return { channel, eligible: true, reason: "free funnel proven + CAC healthy + autonomy earned — amplify what already converts" };
  });
}

/** The channels the autopilot may act on right now, in priority order. Pure. */
export function eligibleMarketingChannels(state: MarketingState): MarketingChannel[] {
  return evaluateMarketingChannels(state).filter((d) => d.eligible).map((d) => d.channel);
}

/** One-line self-marketing posture for the daily letter. Pure. */
export function marketingPostureLine(state: MarketingState): string {
  const eligible = eligibleMarketingChannels(state);
  const free = eligible.filter((c) => c.costClass === "free").length;
  const paid = eligible.filter((c) => c.costClass === "paid").length;
  if (eligible.length === 0) return "Self-marketing: idle — flip the publish switch to start the free snowball.";
  const paidTxt = paid > 0 ? " · paid amplification UNLOCKED (funnel proven)" : " · paid still locked (proving the free funnel first)";
  return `Self-marketing: ${free} free channel(s) running${paidTxt}.`;
}
