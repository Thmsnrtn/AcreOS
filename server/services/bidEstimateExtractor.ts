/**
 * Bid-estimate extraction (CT-3).
 *
 * Devon §2.2: "I want to put them side-by-side: line by line, where does
 * Marcus go cheaper than Tony on flooring; where does Carlos pad the
 * demolition. […] this is exactly the kind of LLM-extraction problem the
 * platform brags about for other workflows."
 *
 * Takes free-text contractor estimate (pasted from PDF, email body, or
 * an OCR'd image) and returns the FF-5 bid shape:
 *   { totalCents, categoryBreakdown, notes }
 *
 * categoryBreakdown is a Record<RehabLineCategory, cents>. The LLM is
 * instructed to map line items into our 23-category taxonomy; an item
 * that doesn't fit cleanly goes into 'other'.
 *
 * Cost: this is a SIMPLE task (well-structured extraction with a fixed
 * output schema), routed to deepseek-chat by default ($0.14/$0.28 per
 * million tokens).
 */

import { routeSimpleTask } from "./aiRouter";
import { REHAB_LINE_CATEGORIES } from "@shared/schema";
import { logger } from "../utils/logger";

export interface ExtractedBid {
  totalCents: number;
  categoryBreakdown: Partial<Record<typeof REHAB_LINE_CATEGORIES[number], number>>;
  notes?: string;
  /** Confidence 0-1 the LLM assigns to its own extraction. */
  confidence: number;
  warnings: string[];
}

const SYSTEM_PROMPT = `You are a careful contractor-estimate parser for a real-estate operations platform.

Given a free-text contractor estimate (paste of a PDF body, email, or OCR transcript), extract:

1. TOTAL — the bottom-line total in CENTS. If the document gives multiple totals (e.g. "subtotal" then "with tax"), pick the FINAL total the customer would pay. Round to whole cents.

2. CATEGORY BREAKDOWN — a flat object mapping our category keys to cents. Each line item gets bucketed into ONE of these categories:
   demolition, framing, roof, siding, windows, exterior_paint, interior_paint,
   flooring, kitchen, bathroom, hvac, plumbing, electrical, drywall, trim_doors,
   appliances, landscaping, permits, dumpster, cleaning, punch_list, contingency, other

   - "Tear-out" / "demo" → demolition
   - "Cabinets" / "countertops" / "backsplash" → kitchen
   - "Tile" / "vanity" / "shower" → bathroom (UNLESS the line is part of a non-bathroom space)
   - "Lights" / "outlets" / "panel" → electrical
   - "AC" / "furnace" / "ductwork" → hvac
   - "Drywall" / "skim coat" → drywall
   - "Trim" / "casing" / "doors" → trim_doors
   - "Tax" / "labor markup" not tied to a category → distribute proportionally; if you can't, put in 'other'
   - "Contingency" / "buffer" / "10% reserve" → contingency
   - Permits / dumpster fees / final cleaning → their own categories

3. NOTES — one short sentence flagging anything unusual (multi-phase project, conditional pricing, items deferred to change order, etc.).

4. CONFIDENCE — your honest 0-1 estimate of extraction accuracy. Lower it when:
   - The total doesn't match the sum of line items
   - You had to bucket >25% of dollar value into 'other'
   - Multiple bottom-line numbers without a clear "FINAL" indicator

5. WARNINGS — array of short strings, one per concern. Examples:
   - "Total mismatch: $58,420 stated vs $57,910 sum of line items"
   - "Tax line ($2,940) distributed proportionally"
   - "Contractor name missing"

OUTPUT STRICT JSON, no markdown, no commentary:
{
  "totalCents": number,
  "categoryBreakdown": { "<category>": number, ... },
  "notes": string,
  "confidence": number,
  "warnings": string[]
}`;

const VALID_CATEGORIES = new Set<string>(REHAB_LINE_CATEGORIES);

export async function extractBidEstimate(rawText: string, orgId?: number): Promise<ExtractedBid> {
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("Empty estimate text");
  }

  const userPrompt = `Contractor estimate text:\n\n${rawText.slice(0, 12_000)}\n\nReturn JSON only.`;

  let response;
  try {
    response = await routeSimpleTask(SYSTEM_PROMPT, userPrompt, { orgId, skipQuota: false });
  } catch (err: any) {
    logger.error("[CT-3] LLM extraction failed", err);
    throw err;
  }

  // Strip code fences if the model wrapped its output despite instructions.
  let body = response.content.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("LLM returned non-JSON response; estimate could not be parsed");
  }

  // Validate + sanitize.
  const totalCents = Math.round(Number(parsed.totalCents ?? 0));
  if (!Number.isFinite(totalCents) || totalCents < 0) {
    throw new Error("Extracted total is not a valid non-negative number");
  }

  const categoryBreakdown: Partial<Record<typeof REHAB_LINE_CATEGORIES[number], number>> = {};
  const rawBreakdown = (parsed.categoryBreakdown ?? {}) as Record<string, unknown>;
  let breakdownSum = 0;
  for (const [k, v] of Object.entries(rawBreakdown)) {
    const cents = Math.round(Number(v));
    if (!VALID_CATEGORIES.has(k)) continue;  // drop unknown categories
    if (!Number.isFinite(cents) || cents < 0) continue;
    categoryBreakdown[k as typeof REHAB_LINE_CATEGORIES[number]] = cents;
    breakdownSum += cents;
  }

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 10) : [];
  // Server-side sanity check: if total and breakdown sum diverge >10%, add a warning.
  if (totalCents > 0 && Math.abs(breakdownSum - totalCents) > totalCents * 0.10) {
    warnings.push(
      `Server check: line-item sum $${(breakdownSum / 100).toFixed(0)} vs stated total $${(totalCents / 100).toFixed(0)} (>10% gap)`,
    );
  }

  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.5)));

  return {
    totalCents,
    categoryBreakdown,
    notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 1000) : undefined,
    confidence,
    warnings,
  };
}
