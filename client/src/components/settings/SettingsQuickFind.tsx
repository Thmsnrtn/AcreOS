import { useEffect, useMemo, useRef, useState } from "react";
import { Search, ArrowRight, Command } from "lucide-react";
import { useLocation } from "wouter";
import { PAX_CONTROLS_PATH, PAX_SETTINGS_COPY } from "@shared/pax-glossary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * SettingsQuickFind — a single search input that maps the user's intent to
 * the right tab + scroll target inside settings.tsx.
 *
 * The settings page is genuinely large (7 tabs × many sections). Rather
 * than refactor every section, this surface lets the user type "two
 * factor" / "stripe" / "vat" / "theme" and jump straight to where the
 * setting lives — without scrolling through three other categories first.
 *
 * The catalog is hand-curated so the keyword list maps cleanly to user
 * intent rather than to component names. When you add a new section
 * to settings.tsx, add a row here so it stays discoverable.
 */

type SettingsEntry = {
  label: string;
  description: string;
  tab: "account" | "security" | "organization" | "billing" | "tax-compliance" | "notifications" | "integrations";
  keywords: string;
  /** A nested page (e.g. /settings/pax, /settings/byok) instead of a tab scroll. */
  href?: string;
};

const CATALOG: SettingsEntry[] = [
  { label: "Profile + name", description: "Display name, email, avatar", tab: "account", keywords: "name email avatar profile photo display" },
  { label: "Appearance / theme", description: "Themes, fonts, density, motion", tab: "account", keywords: "theme dark light bedrock dirtpass homestead font sf appearance ui color" },
  { label: "Persona vocabulary", description: "Land flipper / fix-and-flip / note investor labels", tab: "account", keywords: "persona vocabulary lead deal investor type land flipper note fix flip" },
  { label: "Referrals", description: "Invite friends and earn credit", tab: "account", keywords: "referral invite share friends bonus" },
  { label: "Privacy / DSAR", description: "Data export, deletion, GDPR", tab: "account", keywords: "privacy data export dsar gdpr delete download my data" },
  { label: "Two-factor auth (2FA)", description: "Enable TOTP / SMS", tab: "security", keywords: "2fa two factor mfa totp authenticator security otp" },
  { label: "Active sessions", description: "Revoke other browser sessions", tab: "security", keywords: "sessions devices logout revoke browser" },
  { label: "Password", description: "Change account password", tab: "security", keywords: "password change reset login" },
  { label: "Team members", description: "Invite + role + view-only", tab: "organization", keywords: "team members invite role admin user seat" },
  { label: "Co-owners", description: "Org co-owner / shared workspace", tab: "organization", keywords: "co-owner co owner shared organization owner ownership" },
  { label: "Org goals", description: "Set revenue / lead targets", tab: "organization", keywords: "goals revenue targets lead deal metrics okr" },
  { label: "Org profile", description: "Company name, branding", tab: "organization", keywords: "company organization brand logo name" },
  { label: "Subscription", description: "Plan, seats, upgrade", tab: "billing", keywords: "subscription plan upgrade downgrade tier pro scale starter price" },
  { label: "Payment method", description: "Card on file, Stripe portal", tab: "billing", keywords: "payment card credit billing stripe portal invoice receipt" },
  { label: "Invoices", description: "Past billing history", tab: "billing", keywords: "invoice history receipt past charge" },
  { label: "Tax setup", description: "W-9, VAT, sales tax", tab: "tax-compliance", keywords: "tax w9 w-9 vat sales tax id ein number 1099" },
  { label: "Compliance forms", description: "Statutory / state forms", tab: "tax-compliance", keywords: "compliance statutory state form disclosure tila respa filing" },
  { label: "Email notifications", description: "What we email you about", tab: "notifications", keywords: "email notification alert digest weekly" },
  { label: "SMS alerts", description: "Critical text notifications", tab: "notifications", keywords: "sms text phone alert critical mobile" },
  { label: "Push notifications", description: "Browser + PWA pushes", tab: "notifications", keywords: "push browser pwa desktop notification" },
  { label: "API keys", description: "Manage org API keys", tab: "integrations", keywords: "api key token developer rest webhook scope" },
  { label: PAX_SETTINGS_COPY.quickFind.byok.label, description: PAX_SETTINGS_COPY.quickFind.byok.description, tab: "integrations", keywords: "byok own keys twilio sendgrid lob openai anthropic openrouter attom regrid key credentials", href: "/settings/byok" },
  { label: "Stripe Connect", description: "Contractor payouts", tab: "integrations", keywords: "stripe connect payout contractor ach payment" },
  { label: "Webhooks", description: "Outbound event subscriptions", tab: "integrations", keywords: "webhook outbound event subscription endpoint url" },
  // Settings → Pax (AUTONOMY_SPEC.md §3a entry points) — one nested page.
  { label: PAX_SETTINGS_COPY.quickFind.pax.label, description: PAX_SETTINGS_COPY.quickFind.pax.description, tab: "integrations", keywords: "pax ai ask asks sending everything stance switch rules runs own scheduled prompts lead scoring borrower reminders drafts", href: PAX_CONTROLS_PATH },
  { label: PAX_SETTINGS_COPY.quickFind.pause.label, description: PAX_SETTINGS_COPY.quickFind.pause.description, tab: "integrations", keywords: "pause stop resume pax kill off hold", href: PAX_CONTROLS_PATH },
  { label: PAX_SETTINGS_COPY.quickFind.waiting.label, description: PAX_SETTINGS_COPY.quickFind.waiting.description, tab: "integrations", keywords: "waiting tap approve reject edit pending queue drafts pax wrote", href: "/ai" },
];

interface SettingsQuickFindProps {
  onJump: (tab: SettingsEntry["tab"]) => void;
}

export function SettingsQuickFind({ onJump }: SettingsQuickFindProps) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Cmd+K / Ctrl+K focuses the input. /-press also focuses it, GitHub-style.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "/" && !inField) {
        e.preventDefault();
        inputRef.current?.focus();
      }
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
    if (entry.href) {
      setLocation(entry.href);
    } else {
      onJump(entry.tab);
      window.location.hash = entry.tab;
    }
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
          placeholder="Find a setting… (Cmd+K, or press /)"
          aria-label="Search settings"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          className="w-full h-10 pl-9 pr-16 rounded-card border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-micro text-muted-foreground border border-border rounded px-1.5 py-0.5 hidden sm:inline-flex items-center gap-0.5">
          <Command className="w-2.5 h-2.5" aria-hidden="true" />K
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
              <li key={`${entry.tab}-${entry.label}`} role="option" aria-selected={idx === activeIndex}>
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
                      {entry.tab} · {entry.description}
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
