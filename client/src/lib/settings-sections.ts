/**
 * Settings section registry — Wave 1.5 (master-handoff P2 §1).
 *
 * ONE source of truth for the settings IA: five groups, ~24 routed sections.
 * Three surfaces derive from this registry and may not drift from each other:
 *
 *   1. the left rail + mobile section picker in `pages/settings.tsx`;
 *   2. the routed section switch (each non-standalone section lazy-loads
 *      `pages/settings/<id>-section.tsx` inside the settings shell);
 *   3. the ⌘K command palette's settings destinations
 *      (`components/command-palette.tsx`).
 *
 * `settingsDecomposition.test.ts` pins all three derivations plus the
 * legacy-value map below, and ratchets `TabsContent` in the settings tree
 * to zero — the 1,843-line tab monolith (which produced the
 * duplicate-TabsContent bug class twice) is retired and may not regrow.
 *
 * Sections marked `standalone` predate the decomposition as full pages with
 * their own <Route> in App.tsx (own PageShell, no rail). They stay standalone
 * this wave — the registry lists them so the rail, palette, and QuickFind
 * reach every REGISTERED section (which is what the suite actually proves);
 * folding them into the shell layout is follow-up work, not a prerequisite.
 * The claim is deliberately narrower than "100% of the settings inventory":
 * that sweep is only true once every stray settings page is either
 * registered or deleted (pages/settings/api-keys.tsx was an unrouted,
 * unimported orphan and was deleted with this wave).
 */

export type SettingsGroupId = "you" | "workspace" | "pax" | "data" | "money";

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  /** One-line readiness framing shown on the overview. */
  blurb: string;
}

/** Group order mirrors frequency of use (P2 §1.3): daily-ish → rarely. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: "you", label: "You", blurb: "Your profile, appearance, and personal alerts." },
  { id: "workspace", label: "Workspace", blurb: "Organization, team, and how the workspace speaks your vertical." },
  { id: "pax", label: "Pax & Automation", blurb: "What Pax may do on its own, and the automations behind the doors." },
  { id: "data", label: "Data & Integrations", blurb: "Connected providers, credentials, and your data in and out." },
  { id: "money", label: "Money & Compliance", blurb: "Plan, billing, tax, and the rules that keep sends legal." },
] as const;

export interface SettingsSection {
  /** Slug — the route is `/settings/<id>` (standalone sections may override via `path`). */
  id: string;
  label: string;
  /** Plain-language consequence copy (what lives here), not component names. */
  description: string;
  group: SettingsGroupId;
  /** Space-separated QuickFind/palette keywords (user intent, not internals). */
  keywords: string;
  /**
   * True when the section is a pre-existing full page with its own <Route>
   * registration in App.tsx (renders its own PageShell — NOT rendered inside
   * the settings shell). Absent/false = the shell lazy-loads
   * `@/pages/settings/<id>-section`.
   */
  standalone?: boolean;
  /** Route override for standalone sections whose path ≠ `/settings/<id>`. */
  path?: string;
  /** Feature flag that must be ON for the section to exist (rail + palette + route). */
  flag?: string;
  /**
   * Which ORG-SCOPED health feed backs this section's status row on the
   * overview (P2 §1.4 status-row grammar). "comms" =
   * /api/settings/integrations/status — the org's OWN connected providers
   * with validation state. Absent = no org-scoped health exists for this
   * section: honest absence, no invented state sentence. Platform-level
   * readiness is never a lane; whether ACREOS holds a key says nothing
   * about what this org has connected.
   */
  statusLane?: "comms";
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // ── You ────────────────────────────────────────────────────────────────
  {
    id: "profile",
    label: "Profile & sharing",
    description: "Your referral link, transparency reports, and personal data controls.",
    group: "you",
    keywords: "profile account referral invite share earn transparency data sources privacy export delete personal",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme, type, density, and the small comforts of the workspace.",
    group: "you",
    keywords: "appearance theme dark light font density motion preferences color",
  },
  {
    id: "accessibility",
    label: "Accessibility",
    description: "Reading, motion, and comfort accommodations.",
    group: "you",
    keywords: "accessibility lexend dyslexia contrast reading taps focus comfort",
    standalone: true,
  },
  {
    id: "security",
    label: "Security & sessions",
    description: "Password, two-factor authentication, and account activity.",
    group: "you",
    keywords: "security 2fa two factor mfa totp password sessions devices activity log login",
  },
  {
    id: "notifications",
    label: "Notifications & quiet hours",
    description: "What reaches you, on which channel, and when.",
    group: "you",
    keywords: "notifications quiet hours alerts email sms push digest channels",
  },

  // ── Workspace ──────────────────────────────────────────────────────────
  {
    id: "organization",
    label: "Organization",
    description: "Business goals, onboarding, and workspace-wide preferences.",
    group: "workspace",
    keywords: "organization goals revenue targets okr onboarding tips setup wizard rerun",
  },
  {
    id: "team",
    label: "Team & roles",
    description: "Invites, member roles, and co-owners.",
    group: "workspace",
    keywords: "team members invite roles admin member va viewer co-owner ownership seat",
  },
  {
    id: "lead-assignment",
    label: "Lead assignment",
    description: "Rules that route new leads to teammates.",
    group: "workspace",
    keywords: "lead assignment routing rules round robin va territory",
    standalone: true,
  },
  {
    id: "vertical",
    label: "Vertical & vocabulary",
    description: "Your business type and the words the workspace uses for it.",
    group: "workspace",
    keywords: "persona vertical vocabulary business type land flipper fix flip note investor labels",
  },

  // ── Pax & Automation ───────────────────────────────────────────────────
  {
    id: "autonomy",
    label: "Autonomy",
    description: "How much Pax may do without asking you first.",
    group: "pax",
    keywords: "autonomy matrix ai permission autonomous approvals agent rules",
    flag: "feature.autonomy-matrix",
  },
  {
    id: "pax",
    label: "Pax controls",
    description: "Pause, budgets, and Pax's operating limits.",
    group: "pax",
    keywords: "pax pause budget controls ai assistant limits",
    standalone: true,
  },
  {
    id: "pax-tasks",
    label: "Scheduled tasks",
    description: "Recurring jobs Pax runs for you.",
    group: "pax",
    keywords: "pax tasks scheduled recurring jobs cron automation",
  },
  {
    id: "workflows",
    label: "Workflows",
    description: "Trigger-action rules across your pipeline.",
    group: "pax",
    keywords: "workflows automations triggers rules actions",
  },

  // ── Data & Integrations ────────────────────────────────────────────────
  {
    id: "communications",
    label: "Mailbox, domains & phone numbers",
    description: "Sender identities, email domains, return addresses, and phone numbers.",
    group: "data",
    keywords: "email mailbox domain phone sms mail sender identity twilio sendgrid lob communications providers connect",
    statusLane: "comms",
  },
  {
    id: "providers",
    label: "AI & data providers",
    description: "Model routing, provider configuration, and AI spend.",
    group: "data",
    keywords: "ai providers cost model routing service data openrouter spend",
    // No status lane: there is no ORG-SCOPED AI-key health to read at HEAD
    // (the BYOK status endpoint covers lob/regrid/twilio/sendgrid/rapidapi),
    // and the platform's own key is not this org's state — saying "your AI
    // provider key is connected" off AcreOS's key was the fabrication the
    // fleet-8 audit caught. Add the lane back when org AI keys have health.
  },
  {
    id: "byok",
    label: "Your provider keys (BYOK)",
    description: "Bring your own Twilio, SendGrid, or AI keys so usage bills to you.",
    group: "data",
    keywords: "byok bring your own key openai anthropic twilio sendgrid credentials secret",
    standalone: true,
  },
  {
    id: "integrations",
    label: "Slack & Teams",
    description: "Webhook notifications into your chat tools.",
    group: "data",
    keywords: "slack teams webhook integration notify channel chat",
    standalone: true,
  },
  {
    id: "data",
    label: "Data & fields",
    description: "Custom fields, import, and export.",
    group: "data",
    keywords: "data custom fields import export csv upload download",
  },
  {
    id: "api",
    label: "API & developer",
    description: "API keys, the activity audit log, and demo data.",
    group: "data",
    keywords: "api key token developer rest audit log demo seed test data",
  },

  // ── Money & Compliance ─────────────────────────────────────────────────
  {
    id: "billing",
    label: "Billing & plan",
    description: "Plan, seats, usage, credits, and payment.",
    group: "money",
    keywords: "billing plan subscription upgrade downgrade tier seats usage credits invoice payment stripe cancel",
  },
  {
    id: "tax-identity",
    label: "Tax identity & 1099s",
    description: "Legal entity, EIN/SSN, and the details behind your 1099 forms.",
    group: "money",
    keywords: "tax identity ein ssn itin w9 w-9 1099 legal entity",
    standalone: true,
  },
  {
    id: "underwriting",
    label: "Underwriting defaults",
    description: "Default assumptions behind your deal math.",
    group: "money",
    keywords: "underwriting defaults assumptions ltv rates margins deal math",
    standalone: true,
  },
  {
    id: "compliance",
    label: "Compliance",
    description: "TCPA, DNC, and the rules on outbound sends.",
    group: "money",
    keywords: "compliance tcpa dnc do not call legal disclosures forms statutory",
  },
  {
    id: "privacy",
    label: "Privacy & data requests",
    description: "Export or erase what AcreOS holds about you.",
    group: "money",
    keywords: "privacy dsar gdpr ccpa export erase delete data rights requests",
    standalone: true,
  },
] as const;

/** Canonical route for a section. */
export function settingsSectionPath(section: SettingsSection): string {
  return section.path ?? `/settings/${section.id}`;
}

export function settingsSectionById(id: string): SettingsSection | null {
  return SETTINGS_SECTIONS.find((s) => s.id === id) ?? null;
}

export function settingsSectionsInGroup(group: SettingsGroupId): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => s.group === group);
}

/* ── Legacy value map ────────────────────────────────────────────────────
 *
 * Every tab value the settings surface has EVER answered to — the 7
 * canonical buckets of the tab era, the 17-tab era's hashes, the `?tab=`
 * forms that live links emit (server upgradeUrls, provider banners,
 * cmdk verbs), and the two retired path slugs (/settings/email, /mail).
 * Same mechanism as FOUNDER_LEGACY_REDIRECTS in route-redirects.ts:
 * values are section IDS in the registry above (never paths), so a legacy
 * value can only ever land on a live routed section — the test derives
 * liveness from the registry.
 *
 * Server-side emitters (middleware/usageLimitGate.ts, services/dunning.ts,
 * emailRegistry.ts, webhookHandlers.ts) still emit `/settings#billing`,
 * `/settings#referral`, `/settings?tab=billing` — those literals are pinned
 * by their own tests and CANNOT break: the shell resolves both forms here.
 */
export const SETTINGS_LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  // 7-bucket tab era (VALID_TABS)
  account: "profile",
  security: "security",
  organization: "organization",
  billing: "billing",
  "tax-compliance": "compliance",
  notifications: "notifications",
  integrations: "communications", // every live `?tab=integrations` link says "Connect provider" — that's the comms home
  // 17-tab era hashes (LEGACY_TO_CANONICAL)
  general: "profile",
  privacy: "privacy",
  referral: "profile",
  appearance: "appearance",
  autonomy: "autonomy",
  goals: "organization",
  communications: "communications",
  team: "team",
  payments: "billing",
  data: "data",
  automations: "workflows",
  developer: "api",
  ai: "providers",
  "ai-tasks": "pax-tasks",
  // `?tab=` forms live links emit that never had a tab (cmdkVerbs, inbox)
  org: "organization",
  providers: "providers",
  // Retired path slugs — /settings/email and /settings/mail were
  // redirect-stub <Route>s in App.tsx; the /settings/:section shell
  // resolves them through this map now.
  email: "communications",
  mail: "communications",
};

/** Resolve a legacy tab/hash/slug value to its routed section path, or null. */
export function resolveLegacySettingsTab(value: string): string | null {
  const sectionId = SETTINGS_LEGACY_REDIRECTS[value.toLowerCase()];
  if (!sectionId) return null;
  const section = settingsSectionById(sectionId);
  return section ? settingsSectionPath(section) : null;
}

/**
 * Resolve a legacy /settings location (search + hash) to its routed section
 * URL, or null when there is nothing legacy about it.
 *
 * Handles all three live legacy grammars:
 *   /settings?tab=billing            → /settings/billing
 *   /settings#billing                → /settings/billing
 *   /settings#billing?tier=pro       → /settings/billing?tier=pro
 * (the `?tier=` rides INSIDE the hash on upgrade-toast/dunning links — a
 * pseudo-query that must be promoted to a real one; see the old monolith's
 * getHashParts). Hash wins over ?tab= when both are present, matching the
 * monolith, which only ever read the hash. Non-tab params are preserved.
 */
export function resolveLegacySettingsLocation(search: string, hash: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const tabParam = params.get("tab");
  params.delete("tab");

  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const [hashValue, pseudoQuery] = rawHash.split("?");
  for (const [key, value] of new URLSearchParams(pseudoQuery ?? "")) {
    params.set(key, value);
  }

  const target =
    (hashValue ? resolveLegacySettingsTab(hashValue) : null) ??
    (tabParam ? resolveLegacySettingsTab(tabParam) : null) ??
    // Stripe checkout returns to `/settings?subscription=success|cancelled`
    // (server literal in routes-billing.ts — pinned by its tests). That
    // arrival is a billing intent: the toast + supplemental analytics event
    // live in the billing section now, so route it there with the param.
    (params.has("subscription") ? resolveLegacySettingsTab("billing") : null);
  if (!target) return null;

  const rest = params.toString();
  return rest ? `${target}?${rest}` : target;
}
