/**
 * Settings shell — five-group left rail with ROUTED sections (Wave 1.5,
 * master-handoff P2 §1).
 *
 * The 1,843-line tab monolith that lived here (7 canonical tabs, 20
 * TabsContent-era occurrences, and the duplicate-TabsContent bug class it
 * produced twice — self-documented at its old lines 1237/1624) is retired.
 * This file now does exactly three jobs:
 *
 *   1. resolve LEGACY locations — the `?tab=` and `#hash` forms, the
 *      upgrade-toast pseudo-query `/settings#billing?tier=pro`, the Stripe
 *      return `/settings?subscription=…`, and the retired path slugs
 *      /settings/email, /settings/mail — onto their routed section
 *      (`resolveLegacySettingsLocation` in lib/settings-sections.ts);
 *   2. render the five-group rail (desktop) / grouped Select (mobile) and
 *      the overview with P2 §1.4 status rows — state sentences derived ONLY
 *      from ORG-SCOPED health (/api/settings/integrations/status); sections
 *      with no org-scoped health show no invented state, and platform-level
 *      readiness is never passed off as the org's own;
 *   3. lazy-load the active section from `pages/settings/<id>-section.tsx`.
 *
 * ONE source of truth: rail, routes, mobile picker, and the ⌘K palette all
 * derive from SETTINGS_SECTIONS (lib/settings-sections.ts) —
 * settingsDecomposition.test.ts pins the derivation and ratchets
 * TabsContent in the settings tree to zero.
 */
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { SettingsQuickFind } from "@/components/settings/SettingsQuickFind";
import { useFlag } from "@/contexts/feature-flags-context";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useLocation, useSearch, Link, Redirect } from "wouter";
import { Suspense, lazy, useEffect, type ComponentType, type LazyExoticComponent } from "react";
import {
  SETTINGS_GROUPS,
  type SettingsSection,
  settingsSectionPath,
  settingsSectionById,
  settingsSectionsInGroup,
  resolveLegacySettingsTab,
  resolveLegacySettingsLocation,
} from "@/lib/settings-sections";
import { cn } from "@/lib/utils";
import "./today.css";

/**
 * Section id → lazy chunk. Every non-standalone registry section MUST have
 * an entry here (settingsDecomposition.test.ts derives the required set
 * from the registry and greps these import specifiers).
 */
const SECTION_COMPONENTS: Record<string, LazyExoticComponent<ComponentType>> = {
  profile: lazy(() => import("@/pages/settings/profile-section")),
  appearance: lazy(() => import("@/pages/settings/appearance-section")),
  security: lazy(() => import("@/pages/settings/security-section")),
  notifications: lazy(() => import("@/pages/settings/notifications-section")),
  organization: lazy(() => import("@/pages/settings/organization-section")),
  team: lazy(() => import("@/pages/settings/team-section")),
  vertical: lazy(() => import("@/pages/settings/vertical-section")),
  autonomy: lazy(() => import("@/pages/settings/autonomy-section")),
  "pax-tasks": lazy(() => import("@/pages/settings/pax-tasks-section")),
  workflows: lazy(() => import("@/pages/settings/workflows-section")),
  communications: lazy(() => import("@/pages/settings/communications-section")),
  providers: lazy(() => import("@/pages/settings/providers-section")),
  data: lazy(() => import("@/pages/settings/data-section")),
  api: lazy(() => import("@/pages/settings/api-section")),
  billing: lazy(() => import("@/pages/settings/billing-section")),
  compliance: lazy(() => import("@/pages/settings/compliance-section")),
};

/** /api/settings/integrations/status shape — the org's OWN BYOK
 *  integrations (isAuthenticated + getOrCreateOrg, org-scoped). */
interface OrgIntegrationStatus {
  provider: string;
  isConfigured: boolean;
  maskedKey?: string;
  lastValidatedAt?: string;
  validationError?: string | null;
}

export default function Settings() {
  useDocumentTitle("Settings — AcreOS");
  const [location, navigate] = useLocation();
  const search = useSearch();
  // The autonomy matrix is founder-gated (design-system §8.4) — the flag
  // decides whether the section EXISTS on this surface (rail + picker).
  const autonomyFlag = useFlag("feature.autonomy-matrix");

  const sectionVisible = (s: SettingsSection): boolean => {
    if (!s.flag) return true;
    if (s.flag === "feature.autonomy-matrix") return autonomyFlag;
    return false; // unknown flag → hidden until someone wires it here
  };

  // ── Legacy-location resolution ─────────────────────────────────────────
  // Server emails, upgrade toasts, and old bookmarks still say
  // `/settings#billing`, `/settings#billing?tier=pro`, and `?tab=` forms.
  // Hash-only changes don't flow through wouter, so a hashchange listener
  // catches in-app clicks on those anchors while the shell is mounted.
  const slug = location.startsWith("/settings/")
    ? location.slice("/settings/".length).replace(/\/+$/, "")
    : "";

  useEffect(() => {
    // ROOT ONLY (fleet-8 verifier catch). Resolving legacy grammar on every
    // /settings/* path meant any in-page anchor whose fragment collided with
    // a legacy token — #team, #data, #billing, #security, #privacy… — quietly
    // teleported the reader to a different section, which also blocks the
    // setting-level anchors P2 §1.4 asks for. On a routed section, fragments
    // are the section's own business and pass through untouched.
    if (slug) return;
    const applyLegacyHash = () => {
      const target = resolveLegacySettingsLocation(window.location.search, window.location.hash);
      if (target && target !== `${window.location.pathname}${window.location.search}`) {
        navigate(target, { replace: true });
      }
    };
    applyLegacyHash();
    window.addEventListener("hashchange", applyLegacyHash);
    return () => window.removeEventListener("hashchange", applyLegacyHash);
  }, [navigate, location, slug]);

  // Legacy grammar on the root path (?tab= / #hash / ?subscription=) —
  // redirect declaratively as well (the effect above covers hash-only
  // transitions; this covers first paint with a query string).
  if (!slug) {
    const legacyTarget = resolveLegacySettingsLocation(search, typeof window !== "undefined" ? window.location.hash : "");
    if (legacyTarget) return <Redirect to={legacyTarget} replace />;
  }

  const section = slug ? settingsSectionById(slug) : null;

  if (slug && !section) {
    // Retired slugs (/settings/email, /settings/mail) and legacy tab values
    // used as paths resolve through the same map; anything unknown lands on
    // the overview rather than a dead end.
    const legacyTarget = resolveLegacySettingsTab(slug);
    return <Redirect to={legacyTarget ?? "/settings"} replace />;
  }

  if (section && !sectionVisible(section)) {
    return <Redirect to="/settings" replace />;
  }

  // Standalone sections have their own <Route> + PageShell — this shell
  // never renders them. Reaching here with a standalone slug means the
  // App.tsx registration order broke; send the user to the real page.
  if (section?.standalone) {
    return <Redirect to={settingsSectionPath(section)} replace />;
  }

  const ActiveSection = section ? SECTION_COMPONENTS[section.id] : null;

  return (
    <PageShell label="Settings" maxWidth="6xl">
      {/* Mobile back-to-app affordance. PageTopbar's breadcrumb is hidden
          on mobile, so without this an entrant from the MobileShell brand
          tap has no obvious return path other than the bottom nav. */}
      <div className="md:hidden -mt-2 mb-2">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 px-2 -ml-2 text-muted-foreground"
          onClick={() => navigate("/today")}
          data-testid="button-back-to-today"
          aria-label="Back to Today"
        >
          <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" />
          Back to Today
        </Button>
      </div>

      <div className="acr-cc-hero" style={{ marginTop: 0 }}>
        <div>
          <div className="acr-eyebrow">Settings</div>
          <h1 className="acr-cc-greeting" data-testid="text-settings-title">
            {section ? section.label : "Tune the workspace."}
            <span className="acr-cc-greeting-soft">
              {" "}
              {section ? section.description : "Organization, team, and personal preferences."}
            </span>
          </h1>
        </div>
      </div>

      {/* Quick-find search — jumps to any setting by keyword. Each catalog
          row names a REAL registry section id, so the jump is a direct
          settingsSectionPath() navigation. (Routing it through the
          legacy-tab map collapsed seven rows onto the wrong section —
          "API keys" landed on Mailbox, "Appearance" on Profile.) */}
      <SettingsQuickFind
        onJump={(sectionId) => {
          const target = settingsSectionById(sectionId);
          if (target) navigate(settingsSectionPath(target));
        }}
      />

      {/* Mobile section picker — the rail collapses to the existing Select
          pattern (unchanged mechanism, new five-group taxonomy). */}
      <div className="md:hidden mb-4">
        <Select
          value={section?.id ?? "overview"}
          onValueChange={(value) => {
            if (value === "overview") {
              navigate("/settings");
              return;
            }
            const picked = settingsSectionById(value);
            if (picked) navigate(settingsSectionPath(picked));
          }}
        >
          <SelectTrigger className="w-full" aria-label="Settings section">
            <SelectValue placeholder="Choose a section" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="overview">Overview</SelectItem>
            {SETTINGS_GROUPS.map((group) => (
              <SelectGroup key={group.id}>
                <SelectLabel>{group.label}</SelectLabel>
                {settingsSectionsInGroup(group.id)
                  .filter(sectionVisible)
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="md:grid md:grid-cols-[230px_minmax(0,1fr)] md:gap-8">
        {/* ── Left rail (desktop) — derived from the registry ── */}
        <nav aria-label="Settings sections" className="hidden md:block" data-testid="settings-rail">
          <div className="sticky top-20 space-y-6">
            <Link
              href="/settings"
              className={cn(
                "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
                !section
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
              data-testid="settings-rail-overview"
            >
              Overview
            </Link>
            {SETTINGS_GROUPS.map((group) => {
              const sections = settingsSectionsInGroup(group.id).filter(sectionVisible);
              if (sections.length === 0) return null;
              return (
                <div key={group.id}>
                  <div className="px-2.5 pb-1 text-micro font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </div>
                  <ul className="space-y-0.5">
                    {sections.map((s) => {
                      const path = settingsSectionPath(s);
                      const active = section?.id === s.id;
                      return (
                        <li key={s.id}>
                          <Link
                            href={path}
                            className={cn(
                              "block rounded-md px-2.5 py-1.5 text-sm transition-colors",
                              active
                                ? "bg-accent font-medium text-foreground"
                                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                            )}
                            aria-current={active ? "page" : undefined}
                            data-testid={`settings-rail-${s.id}`}
                          >
                            {s.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </nav>

        {/* ── Content ── */}
        <div className="min-w-0">
          {ActiveSection ? (
            <Suspense
              fallback={
                <div className="space-y-4" aria-busy="true">
                  <Skeleton className="h-8 w-56" announceText={`Loading ${section?.label ?? "section"}`} />
                  <Skeleton className="h-40 w-full" announce={false} />
                  <Skeleton className="h-40 w-full" announce={false} />
                </div>
              }
            >
              <ActiveSection />
            </Suspense>
          ) : (
            <SettingsOverview sectionVisible={sectionVisible} />
          )}
        </div>
      </div>
    </PageShell>
  );
}

/* ── Overview — status rows per P2 §1.4 ──────────────────────────────────
 *
 * Every section row leads with what's TRUE right now, control second.
 * State sentences come only from ORG-SCOPED health that already exists:
 *   - "comms" lane: /api/settings/integrations/status (the org's OWN
 *     connected providers — sendgrid/twilio/lob — with validation state,
 *     so a row can read connected / erroring / not connected.
 * Platform-level readiness is deliberately NOT a source here: whether
 * AcreOS holds a key says nothing about what THIS org has connected, and
 * on a page about your own setup that conflation reads as a lie.
 * Sections without a lane get no sentence — honest absence, not invention.
 */
function SettingsOverview({ sectionVisible }: { sectionVisible: (s: SettingsSection) => boolean }) {
  // ORG-SCOPED truth only (fleet-8 verifier catch). The first draft read
  // /api/integrations/status and the provider-status hook, both of which
  // report the PLATFORM's own credentials — so an org with nothing connected
  // was told "Email ready" and "Your AI provider key is connected" because
  // ACREOS had keys. On a settings page whose whole job is telling you what
  // YOU have connected, that is a fabrication. This endpoint is
  // isAuthenticated + getOrCreateOrg and returns the org's own integrations,
  // including validation state — which is also what lets a row say
  // "erroring" rather than only ready/not-configured (P2 §1.4).
  const { data: orgIntegrations } = useQuery<OrgIntegrationStatus[]>({
    queryKey: ["/api/settings/integrations/status"],
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const statusSentence = (s: SettingsSection): { text: string; attention: boolean } | null => {
    if (s.statusLane === "comms") {
      if (!orgIntegrations) return null; // health not loaded — say nothing rather than guess
      const byProvider = new Map(orgIntegrations.map((i) => [i.provider, i]));
      const lanes: Array<[string, string]> = [
        ["sendgrid", "Email"],
        ["twilio", "SMS"],
        ["lob", "Direct mail"],
      ];
      const parts: string[] = [];
      let attention = false;
      for (const [provider, label] of lanes) {
        const row = byProvider.get(provider);
        if (row?.validationError) {
          parts.push(`${label} erroring`);
          attention = true;
        } else if (row?.isConfigured) {
          parts.push(`${label} connected`);
        } else {
          parts.push(`${label} not connected`);
          attention = true;
        }
      }
      return { text: parts.join(" · "), attention };
    }
    // No "ai" lane: there is no org-scoped AI-key health to read at HEAD
    // (the BYOK status endpoint covers lob/regrid/twilio/sendgrid/rapidapi),
    // and the platform's key is not the org's state. A row that cannot be
    // sourced honestly shows no state sentence at all.
    return null;
  };

  return (
    <div className="space-y-8" data-testid="settings-overview">
      {SETTINGS_GROUPS.map((group) => {
        const sections = settingsSectionsInGroup(group.id).filter(sectionVisible);
        if (sections.length === 0) return null;
        return (
          <section key={group.id} aria-label={group.label}>
            <h2 className="text-section-h2">{group.label}</h2>
            <p className="text-sm text-muted-foreground mb-3">{group.blurb}</p>
            <ul className="divide-y divide-border rounded-card border border-border bg-card">
              {sections.map((s) => {
                const status = statusSentence(s);
                return (
                  <li key={s.id}>
                    <Link
                      href={settingsSectionPath(s)}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40"
                      data-testid={`settings-overview-${s.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{s.label}</span>
                          {s.standalone && (
                            <ExternalLink className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                          )}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {status ? (
                            <span className={status.attention ? "text-acr-warn" : undefined}>
                              {status.text}
                            </span>
                          ) : (
                            s.description
                          )}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
