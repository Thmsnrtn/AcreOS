import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { settingsSectionById } from "@/lib/settings-sections";

/**
 * SettingsQuickFind — a single search input that maps the user's intent to
 * the routed settings section that holds the control.
 *
 * The settings tree is genuinely large (five groups, ~20 sections). Rather
 * than make the user guess which group owns a control, this surface lets
 * them type "two factor" / "stripe" / "vat" / "theme" and jump straight to
 * where the setting lives.
 *
 * The catalog is hand-curated ON PURPOSE and is FINER-GRAINED than the
 * section registry: "Two-factor auth", "Active sessions" and "Password" are
 * three separate rows that all resolve to the Security section, because
 * people search for the control, not the page. Each row therefore names a
 * real registry section id (see SettingsEntry.section) rather than being
 * generated from the registry — and settingsDecomposition.test.ts pins
 * every id against SETTINGS_SECTIONS so the two can never drift.
 */

type SettingsEntry = {
  label: string;
  description: string;
  /**
   * A real SETTINGS_SECTIONS id — NOT a legacy tab token. The decomposition
   * rewired the jump target through the legacy-tab map, which collapsed
   * seven of these rows onto sections that do not hold the control the row
   * names ("Appearance / theme" landed on Profile, "API keys" on Mailbox…).
   * settingsDecomposition.test.ts pins every id here against the registry,
   * so a renamed section breaks the build instead of the navigation.
   */
  section: string;
  keywords: string;
};

const CATALOG: SettingsEntry[] = [
  { label: "Profile + name", description: "Display name, email, avatar", section: "profile", keywords: "name email avatar profile photo display" },
  { label: "Appearance / theme", description: "Themes, fonts, density, motion", section: "appearance", keywords: "theme dark light bedrock dirtpass homestead font sf appearance ui color" },
  { label: "Persona vocabulary", description: "Land flipper / fix-and-flip / note investor labels", section: "vertical", keywords: "persona vocabulary lead deal investor type land flipper note fix flip" },
  { label: "Referrals", description: "Invite friends and earn credit", section: "profile", keywords: "referral invite share friends bonus" },
  { label: "Privacy / DSAR", description: "Data export, deletion, GDPR", section: "privacy", keywords: "privacy data export dsar gdpr delete download my data" },
  { label: "Two-factor auth (2FA)", description: "Enable TOTP / SMS", section: "security", keywords: "2fa two factor mfa totp authenticator security otp" },
  { label: "Active sessions", description: "Revoke other browser sessions", section: "security", keywords: "sessions devices logout revoke browser" },
  { label: "Password", description: "Change account password", section: "security", keywords: "password change reset login" },
  { label: "Team members", description: "Invite + role + view-only", section: "team", keywords: "team members invite role admin user seat" },
  { label: "Co-owners", description: "Org co-owner / shared workspace", section: "team", keywords: "co-owner co owner shared organization owner ownership" },
  { label: "Org goals", description: "Set revenue / lead targets", section: "organization", keywords: "goals revenue targets lead deal metrics okr" },
  { label: "Org profile", description: "Company name, branding", section: "organization", keywords: "company organization brand logo name" },
  { label: "Subscription", description: "Plan, seats, upgrade", section: "billing", keywords: "subscription plan upgrade downgrade tier pro scale starter price" },
  { label: "Payment method", description: "Card on file, Stripe portal", section: "billing", keywords: "payment card credit billing stripe portal invoice receipt" },
  { label: "Invoices", description: "Past billing history", section: "billing", keywords: "invoice history receipt past charge" },
  { label: "Tax setup", description: "W-9, VAT, sales tax", section: "tax-identity", keywords: "tax w9 w-9 vat sales tax id ein number 1099" },
  { label: "Compliance forms", description: "Statutory / state forms", section: "compliance", keywords: "compliance statutory state form disclosure tila respa filing" },
  { label: "Email notifications", description: "What we email you about", section: "notifications", keywords: "email notification alert digest weekly" },
  { label: "SMS alerts", description: "Critical text notifications", section: "notifications", keywords: "sms text phone alert critical mobile" },
  { label: "Push notifications", description: "Browser + PWA pushes", section: "notifications", keywords: "push browser pwa desktop notification" },
  { label: "API keys", description: "Manage org API keys", section: "api", keywords: "api key token developer rest webhook scope" },
  { label: "BYOK (Bring your own keys)", description: "OpenAI / Anthropic credentials", section: "byok", keywords: "byok openai anthropic claude gpt key llm ai credentials" },
  { label: "Stripe Connect", description: "Contractor payouts", section: "billing", keywords: "stripe connect payout contractor ach payment" },
  { label: "Webhooks", description: "Outbound event subscriptions", section: "api", keywords: "webhook outbound event subscription endpoint url" },
  { label: "Autonomy matrix", description: "Founder-only AI autonomy rules", section: "autonomy", keywords: "autonomy ai matrix founder rules permission autonomous agent" },
];

/** The destination's REAL label — the row used to print a retired tab token. */
function sectionLabel(sectionId: string): string {
  return settingsSectionById(sectionId)?.label ?? sectionId;
}

interface SettingsQuickFindProps {
  onJump: (sectionId: SettingsEntry["section"]) => void;
}

export function SettingsQuickFind({ onJump }: SettingsQuickFindProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // "/" focuses this input, GitHub-style. ⌘K is deliberately NOT hijacked
  // (fleet-8 verifier catch): this component used to mount on one route and
  // now mounts on the overview plus every routed section, so swallowing ⌘K
  // would kill the global palette across the whole settings tree — including
  // on the very pages where the palette now indexes settings sections.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // tagName alone missed contentEditable surfaces and ARIA text widgets,
      // so "/" fired while the user was typing in a section control.
      const role = target?.getAttribute?.("role");
      const inField =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        !!target?.isContentEditable ||
        role === "textbox" ||
        role === "combobox" ||
        role === "searchbox";
      if (inField) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return CATALOG.filter((entry) => {
      return (
        entry.label.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.keywords.includes(q) ||
        entry.keywords.split(" ").some((kw) => kw.startsWith(q))
      );
    }).slice(0, 8);
  }, [query]);

  function pick(entry: SettingsEntry) {
    // Navigate ONLY. This used to also write the row's legacy tab token into
    // the location hash, which the shell's legacy-hash resolver then tried to
    // re-resolve — leaving a stale fragment on a routed section path.
    onJump(entry.section);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (results[activeIndex]) {
        e.preventDefault();
        pick(results[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div className="relative mb-4" data-testid="settings-quick-find">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onInputKey}
          placeholder="Find a setting… (press /)"
          aria-label="Search settings"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          className="w-full h-10 pl-9 pr-16 rounded-card border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {/* The hint must match the key we actually own — ⌘K belongs to the
            global palette, which now indexes settings sections itself. */}
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-micro text-muted-foreground border border-border rounded px-1.5 py-0.5 hidden sm:inline-flex items-center gap-0.5">
          /
        </kbd>
      </div>
      {open && query && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label="Settings search results"
          className="absolute z-sticky mt-1 w-full bg-popover border border-border rounded-card shadow-lg overflow-hidden"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted-foreground">
              No settings match "{query}". Try theme, 2fa, billing, api keys…
            </li>
          ) : (
            results.map((entry, idx) => (
              <li key={`${entry.section}-${entry.label}`} role="option" aria-selected={idx === activeIndex}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(entry);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                    idx === activeIndex ? "bg-accent" : "hover:bg-accent/40",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{entry.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {sectionLabel(entry.section)} · {entry.description}
                    </div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
