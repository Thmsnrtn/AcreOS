/**
 * Pillar 2 — Mail Router
 *
 * Single entrypoint for outbound physical mail. Adapters quote per-piece
 * cost against a shipment; the router picks the cheapest viable provider
 * subject to speed / personalization / min-volume constraints.
 *
 * Today only Lob is enabled. PostGrid activates as soon as POSTGRID_API_KEY
 * is set (pay-as-you-go, ~25% cheaper). EDDM / presort / lettrlabs are
 * scaffolded but DISABLED — they unlock at $1k / $5k MRR / premium-SKU
 * revenue triggers respectively. See the per-adapter TODO blocks.
 *
 * The router does NOT post to the financial ledger directly — adapters
 * own that (preserves the Pillar 1.6 hook already living inside the Lob
 * adapter). Adapters return providerEventId + cost so the caller can
 * audit downstream.
 */

import { logger } from "../../utils/logger";
import { getSetting } from "../founderSettings";

// ── Public types ─────────────────────────────────────────────────────────────

export type MailShipmentSpeed =
  | "next_day"
  | "standard"
  | "batch_3d"
  | "batch_weekly"
  | "eddm_geo";

export interface MailPiece {
  recipient: {
    firstName?: string;
    lastName?: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
  };
  templateId?: string;
  vars?: Record<string, string>;
  pieceType: "postcard_4x6" | "postcard_6x9" | "letter_10" | "handwritten";
}

export interface MailShipment {
  customerId: number;
  organizationId: number;
  pieces: MailPiece[];
  speed: MailShipmentSpeed;
  budgetCentsPerPiece?: number;
  personalizationRequired: boolean;
  callbackUrl?: string;
  /** e.g. "lead_nurture_campaign" — propagated to per-piece ledger rows. */
  feature?: string;
}

export type MailProviderName =
  | "lob"
  | "postgrid"
  | "eddm"
  | "presort"
  | "lettrlabs";

export interface ProviderQuote {
  provider: MailProviderName;
  costPerPieceCents: number;
  deliveryEtaDays: number;
  minVolume: number;
  meetsConstraints: boolean;
  reasonIfNot?: string;
}

export interface ProviderSendResult {
  provider: string;
  providerEventId: string;
  pieces: { providerPieceId: string; recipientRef: string }[];
  totalCostCents: number;
}

export interface MailProvider {
  name: MailProviderName;
  quote(shipment: MailShipment): Promise<ProviderQuote>;
  send(shipment: MailShipment): Promise<ProviderSendResult>;
  isConfigured(): boolean;
}

export interface RouteResult {
  chosenProvider: MailProviderName;
  alternatives: ProviderQuote[];
  savedVsLobCents: number;
  result: ProviderSendResult;
}

// ── Provider registry ────────────────────────────────────────────────────────

// Lazy registry. We instantiate adapters once per process. Adapters
// themselves decide via isConfigured() whether to participate.
let _registry: MailProvider[] | null = null;

async function loadProviders(): Promise<MailProvider[]> {
  if (_registry) return _registry;
  const [{ lobAdapter }, { postgridAdapter }, { eddmAdapter }, { presortAdapter }, { lettrlabsAdapter }] =
    await Promise.all([
      import("./providers/lob"),
      import("./providers/postgrid"),
      import("./providers/eddm"),
      import("./providers/presort"),
      import("./providers/lettrlabs"),
    ]);
  _registry = [lobAdapter, postgridAdapter, eddmAdapter, presortAdapter, lettrlabsAdapter];
  return _registry;
}

/** Test-only — clear the cached provider list between cases. */
export function __resetMailRouterRegistry(): void {
  _registry = null;
}

/** Test-only — inject a custom registry. */
export function __setMailRouterRegistry(providers: MailProvider[]): void {
  _registry = providers;
}

// ── Enablement (founder_settings) ────────────────────────────────────────────

const DEFAULT_ENABLED: MailProviderName[] = ["lob"];

async function resolveEnabledProviders(): Promise<MailProviderName[]> {
  try {
    const raw = await getSetting("mail.providers.enabled");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
        return parsed as MailProviderName[];
      }
    }
  } catch (err) {
    logger.warn("[MailRouter] mail.providers.enabled invalid; falling back to default", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }
  return DEFAULT_ENABLED;
}

// ── Router ───────────────────────────────────────────────────────────────────

export class MailRouter {
  /**
   * Quote a shipment across every enabled+configured provider. Disabled
   * or mis-configured adapters are silently skipped; their quotes never
   * surface so the caller doesn't see noise.
   */
  async quote(shipment: MailShipment): Promise<ProviderQuote[]> {
    const enabled = await resolveEnabledProviders();
    const providers = await loadProviders();
    const quotes: ProviderQuote[] = [];

    for (const p of providers) {
      if (!enabled.includes(p.name)) continue;
      if (!p.isConfigured()) continue;
      try {
        const q = await p.quote(shipment);
        quotes.push(q);
      } catch (err) {
        logger.warn(`[MailRouter] ${p.name} quote failed; skipping`, {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    return quotes;
  }

  /**
   * Pick the cheapest viable provider and send. On send failure, falls
   * through to the next-cheapest viable candidate. Surfaces savings vs.
   * the Lob baseline so the founder dashboard can render the win.
   */
  async route(shipment: MailShipment): Promise<RouteResult> {
    const quotes = await this.quote(shipment);
    if (quotes.length === 0) {
      throw new Error(
        "MailRouter.route: no providers available. Ensure at least one of lob/postgrid is configured + enabled.",
      );
    }

    // Viable = meetsConstraints + within budget if specified.
    const viable = quotes.filter((q) => {
      if (!q.meetsConstraints) return false;
      if (shipment.budgetCentsPerPiece != null && q.costPerPieceCents > shipment.budgetCentsPerPiece) {
        return false;
      }
      if (shipment.pieces.length < q.minVolume) return false;
      return true;
    });

    if (viable.length === 0) {
      const reason = quotes
        .map((q) => `${q.provider}=${q.meetsConstraints ? "over_budget_or_volume" : q.reasonIfNot}`)
        .join(", ");
      throw new Error(`MailRouter.route: no viable provider matches constraints (${reason}).`);
    }

    // Sort ascending by cost. Tie-break: prefer aggregation queues (presort)
    // when shipment is patient enough — they amortize postage across orgs.
    const sorted = [...viable].sort((a, b) => {
      if (a.costPerPieceCents !== b.costPerPieceCents) return a.costPerPieceCents - b.costPerPieceCents;
      const aIsBatch = a.provider === "presort" || a.provider === "eddm";
      const bIsBatch = b.provider === "presort" || b.provider === "eddm";
      const canWait = shipment.speed === "batch_3d" || shipment.speed === "batch_weekly";
      if (canWait && aIsBatch !== bIsBatch) return aIsBatch ? -1 : 1;
      return 0;
    });

    const lobQuote = quotes.find((q) => q.provider === "lob");
    const providers = await loadProviders();
    const byName = new Map(providers.map((p) => [p.name, p] as const));

    let lastErr: unknown = null;
    for (const candidate of sorted) {
      const adapter = byName.get(candidate.provider);
      if (!adapter) continue;
      try {
        const result = await adapter.send(shipment);
        const lobBaseline = lobQuote ? lobQuote.costPerPieceCents * shipment.pieces.length : result.totalCostCents;
        const savedVsLobCents = Math.max(0, lobBaseline - result.totalCostCents);
        return {
          chosenProvider: candidate.provider,
          alternatives: sorted.filter((q) => q.provider !== candidate.provider),
          savedVsLobCents,
          result,
        };
      } catch (err) {
        lastErr = err;
        logger.warn(`[MailRouter] ${candidate.provider} send failed; falling through`, {
          metadata: { error: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    throw new Error(
      `MailRouter.route: every viable provider failed. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }
}

export const mailRouter = new MailRouter();

// ── Shared piece-cost helpers (used by Lob + PostGrid adapters) ──────────────

export const PIECE_TYPES = ["postcard_4x6", "postcard_6x9", "letter_10", "handwritten"] as const;
export type PieceType = (typeof PIECE_TYPES)[number];

/**
 * Aggregate per-piece cost across a shipment (heterogeneous shipments
 * sum up correctly). Adapters use this to compute a per-piece average
 * for their quote — the router compares averages.
 */
export function averageCostCentsPerPiece(
  pieces: MailPiece[],
  table: Record<PieceType, number>,
): number {
  if (pieces.length === 0) return 0;
  const total = pieces.reduce((sum, p) => sum + (table[p.pieceType] ?? 0), 0);
  return Math.round(total / pieces.length);
}
