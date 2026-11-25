/**
 * Launch Legal & Peace-of-Mind Readiness — client-side loader + guard.
 *
 * The checklist copy lives in client/src/data/legal-readiness-data.ts
 * (the source of truth) and is served as the static asset
 * /legal-readiness.json instead of riding inside the founder bundle as
 * JS (the BD-6 / diet pattern). This module is the only client consumer
 * of the asset: it fetches through the shared static-data loader,
 * validates the payload with `isLegalReadinessData` (a malformed asset
 * is a load error, never a silently-empty page), and rehydrates each
 * section's icon NAME into its Lucide component — icons stay in code,
 * only copy travels as data. tests/unit/legalReadinessServedAsData
 * .test.ts pins the asset deep-equal to the data module and this
 * module's guard/builder behaviour.
 */

import {
  Building2,
  CreditCard,
  Database,
  FileText,
  MapPin,
  PenTool,
  Scale,
  ShieldCheck,
  Umbrella,
  type LucideIcon,
} from "lucide-react";
import { useStaticData } from "@/lib/static-data";
import type {
  LegalReadinessData,
  LegalReadinessIconKey,
  LegalReadinessItemData,
  LegalReadinessStatus,
} from "@/data/legal-readiness-data";

export const LEGAL_READINESS_URL = "/legal-readiness.json";

/** A checklist section as the page renders it: copy + resolved icon. */
export interface LegalReadinessSection {
  title: string;
  icon: LucideIcon;
  items: LegalReadinessItemData[];
}

const SECTION_ICONS: Record<LegalReadinessIconKey, LucideIcon> = {
  Building2,
  FileText,
  Database,
  Scale,
  CreditCard,
  PenTool,
  ShieldCheck,
  Umbrella,
  MapPin,
};

const STATUSES: ReadonlySet<string> = new Set([
  "done",
  "needs-tom",
  "needs-vendor",
  "open",
]);

const ICON_KEYS: ReadonlySet<string> = new Set(Object.keys(SECTION_ICONS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStr(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isItem(value: unknown): value is LegalReadinessItemData {
  return (
    isRecord(value) &&
    isStr(value.label) &&
    typeof value.status === "string" &&
    STATUSES.has(value.status) &&
    isStr(value.note)
  );
}

function isSection(value: unknown): boolean {
  return (
    isRecord(value) &&
    isStr(value.title) &&
    typeof value.icon === "string" &&
    ICON_KEYS.has(value.icon) &&
    Array.isArray(value.items) &&
    value.items.length > 0 &&
    value.items.every(isItem)
  );
}

/** Runtime guard for the served asset — rejects anything malformed. */
export function isLegalReadinessData(
  value: unknown,
): value is LegalReadinessData {
  return (
    isRecord(value) &&
    Array.isArray(value.sections) &&
    value.sections.length > 0 &&
    value.sections.every(isSection)
  );
}

/** Rebuild the page's sections from validated data (icons back to code). */
export function buildLegalReadinessSections(
  data: LegalReadinessData,
): LegalReadinessSection[] {
  return data.sections.map((section) => ({
    title: section.title,
    icon: SECTION_ICONS[section.icon],
    items: section.items,
  }));
}

/** Count items with a given status across all sections (summary badges). */
export function countLegalReadinessByStatus(
  sections: LegalReadinessSection[],
  status: LegalReadinessStatus,
): number {
  return sections.reduce(
    (n, s) => n + s.items.filter((i) => i.status === status).length,
    0,
  );
}

export interface LegalReadinessState {
  sections: LegalReadinessSection[] | null;
  error: boolean;
}

/**
 * Shell-first hook: `sections` is null while the asset is in flight;
 * a failed fetch OR a malformed payload sets `error` (the page renders
 * a visible failure line, never a silently-empty checklist).
 */
export function useLegalReadinessSections(): LegalReadinessState {
  const { data, error } = useStaticData<unknown>(LEGAL_READINESS_URL);
  if (error) return { sections: null, error: true };
  if (data === null) return { sections: null, error: false };
  if (!isLegalReadinessData(data)) return { sections: null, error: true };
  return { sections: buildLegalReadinessSections(data), error: false };
}
