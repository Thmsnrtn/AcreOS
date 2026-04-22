import { useLocation } from "wouter";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/**
 * Route-derived breadcrumb trail.
 *
 * Turns `/leads/42/activity` into:  Leads › 42 › Activity
 *
 * Segments are title-cased and joined under the top-level section — no
 * per-page wiring needed. If you want custom labels for numeric ids
 * (e.g., showing the lead name instead of "42"), pass `overrides`:
 *
 *   <AutoBreadcrumb overrides={{ [leadId]: lead.firstName }} />
 *
 * Drop into <PageHeader breadcrumbs={<AutoBreadcrumb />} /> or render
 * directly above a page title.
 */

const LABEL_MAP: Record<string, string> = {
  leads: "Leads",
  properties: "Properties",
  deals: "Deals",
  notes: "Notes",
  payments: "Payments",
  tasks: "Tasks",
  campaigns: "Campaigns",
  alerts: "Alerts",
  notifications: "Notifications",
  dashboard: "Dashboard",
  today: "Today",
  activity: "Activity",
  settings: "Settings",
  organization: "Organization",
  "feature-flags": "Feature flags",
  "white-label": "White label",
  intelligence: "Intelligence",
  founder: "Founder",
  academy: "Academy",
  marketplace: "Marketplace",
  "my-letter": "My letter",
  documents: "Documents",
  signing: "Signing",
};

function humanize(segment: string): string {
  if (LABEL_MAP[segment]) return LABEL_MAP[segment];
  // Numeric ids are left raw — callers can pass overrides for display names
  if (/^\d+$/.test(segment)) return segment;
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface AutoBreadcrumbProps {
  /** Map of path segment → display label. Useful for showing lead/property names in place of numeric ids. */
  overrides?: Record<string, string>;
  /** Extra root link before the derived segments (e.g. "Home"). */
  rootLabel?: string;
  /** Path the root link navigates to. Defaults to "/today". */
  rootHref?: string;
}

export function AutoBreadcrumb({
  overrides = {},
  rootLabel,
  rootHref = "/today",
}: AutoBreadcrumbProps) {
  const [location] = useLocation();
  const segments = location.split("/").filter(Boolean);

  // Root-only path (e.g. "/today") — no trail to show
  if (segments.length <= 1 && !rootLabel) return null;

  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    const label = overrides[seg] ?? humanize(seg);
    const isLast = i === segments.length - 1;
    return { href, label, isLast };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {rootLabel && (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink href={rootHref}>{rootLabel}</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        {crumbs.map((c, i) => (
          <BreadcrumbItem key={c.href}>
            {c.isLast ? (
              <BreadcrumbPage>{c.label}</BreadcrumbPage>
            ) : (
              <>
                <BreadcrumbLink href={c.href}>{c.label}</BreadcrumbLink>
              </>
            )}
            {!c.isLast && <BreadcrumbSeparator />}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
