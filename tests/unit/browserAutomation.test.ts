/**
 * Browser Automation Unit Tests
 *
 * Tests browser automation logic (mocked — no real browser):
 * - Source scraping result normalization
 * - Deduplication logic
 * - Retry backoff logic
 * - Normalization pipeline
 * - Health monitoring
 */

import { describe, it, expect } from "vitest";

// ── Types ─────────────────────────────────────────────────────────────────────

type SourceStatus = "healthy" | "degraded" | "down";

interface RawScrapedRecord {
  sourceId: number;
  rawAddress?: string;
  rawPrice?: string;
  rawAcres?: string;
  rawOwner?: string;
  county?: string;
  state?: string;
  parcelNumber?: string;
  scrapedAt: Date;
}

interface NormalizedRecord {
  sourceId: number;
  address: string | null;
  price: number | null;
  acres: number | null;
  owner: string | null;
  county: string;
  state: string;
  parcelNumber: string | null;
  scrapedAt: Date;
}

interface SourceHealth {
  sourceId: number;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date;
  avgResponseMs: number;
  status: SourceStatus;
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function normalizeAddress(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  // Normalize whitespace, capitalize words
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, l => l.toUpperCase());
}

function normalizePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  // Remove currency symbols, commas, whitespace
  const cleaned = raw.replace(/[$,\s]/g, "").replace(/\.00$/, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || parsed <= 0 ? null : Math.round(parsed * 100) / 100;
}

function normalizeAcres(raw: string | undefined): number | null {
  if (!raw) return null;
  // Remove "acres", "ac", "a" suffix and whitespace
  const cleaned = raw.toLowerCase().replace(/\s*(acres?|ac\.?|a)\s*$/i, "").trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) || parsed <= 0 ? null : Math.round(parsed * 100) / 100;
}

function normalizeRecord(raw: RawScrapedRecord): NormalizedRecord {
  return {
    sourceId: raw.sourceId,
    address: normalizeAddress(raw.rawAddress),
    price: normalizePrice(raw.rawPrice),
    acres: normalizeAcres(raw.rawAcres),
    owner: raw.rawOwner?.trim() || null,
    county: raw.county || "",
    state: raw.state || "",
    parcelNumber: raw.parcelNumber?.trim() || null,
    scrapedAt: raw.scrapedAt,
  };
}

function deduplicateRecords(records: NormalizedRecord[]): NormalizedRecord[] {
  const seen = new Set<string>();
  return records.filter(r => {
    const key = r.parcelNumber
      ? `${r.state}-${r.county}-${r.parcelNumber}`
      : `${r.state}-${r.county}-${r.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeRetryDelay(
  attempt: number,
  baseDelayMs: number = 1_000,
  maxDelayMs: number = 60_000,
  jitterFactor: number = 0
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  const jitter = capped * jitterFactor;
  return Math.round(capped + jitter);
}

function shouldRetry(
  attempt: number,
  maxAttempts: number,
  errorType: string
): { retry: boolean; reason?: string } {
  const nonRetryableErrors = ["auth_failed", "blocked_by_site", "invalid_target"];

  if (nonRetryableErrors.includes(errorType)) {
    return { retry: false, reason: `Error type '${errorType}' is not retryable` };
  }
  if (attempt >= maxAttempts) {
    return { retry: false, reason: `Max attempts (${maxAttempts}) reached` };
  }
  return { retry: true };
}

function computeSourceHealth(source: {
  sourceId: number;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date;
  responseTimes: number[];
}): SourceHealth {
  const avgResponseMs =
    source.responseTimes.length > 0
      ? source.responseTimes.reduce((s, t) => s + t, 0) / source.responseTimes.length
      : 0;

  let status: SourceStatus;
  if (source.consecutiveFailures >= 5) {
    status = "down";
  } else if (source.consecutiveFailures >= 2 || avgResponseMs > 10_000) {
    status = "degraded";
  } else {
    status = "healthy";
  }

  return {
    sourceId: source.sourceId,
    consecutiveFailures: source.consecutiveFailures,
    lastSuccessAt: source.lastSuccessAt,
    lastAttemptAt: source.lastAttemptAt,
    avgResponseMs: Math.round(avgResponseMs),
    status,
  };
}

function filterHealthySources(
  sources: SourceHealth[],
  allowDegraded: boolean = false
): SourceHealth[] {
  return sources.filter(s => {
    if (s.status === "healthy") return true;
    if (allowDegraded && s.status === "degraded") return true;
    return false;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Normalization Pipeline", () => {
  it("normalizes a complete raw record", () => {
    const raw: RawScrapedRecord = {
      sourceId: 1,
      rawAddress: "  123 main st, austin  ",
      rawPrice: "$250,000",
      rawAcres: "45.5 acres",
      rawOwner: " John Smith ",
      county: "Travis",
      state: "TX",
      parcelNumber: "001-234",
      scrapedAt: new Date(),
    };
    const normalized = normalizeRecord(raw);
    expect(normalized.address).toBe("123 Main St, Austin");
    expect(normalized.price).toBe(250_000);
    expect(normalized.acres).toBe(45.5);
    expect(normalized.owner).toBe("John Smith");
  });

  it("handles missing optional fields gracefully", () => {
    const raw: RawScrapedRecord = {
      sourceId: 2,
      county: "Hays",
      state: "TX",
      scrapedAt: new Date(),
    };
    const normalized = normalizeRecord(raw);
    expect(normalized.address).toBeNull();
    expect(normalized.price).toBeNull();
    expect(normalized.acres).toBeNull();
    expect(normalized.parcelNumber).toBeNull();
  });
});

describe("Address Normalization", () => {
  it("trims leading and trailing whitespace", () => {
    expect(normalizeAddress("  123 Oak St  ")).toBe("123 Oak St");
  });

  it("normalizes multiple spaces to single space", () => {
    expect(normalizeAddress("123   Oak   St")).toBe("123 Oak St");
  });

  it("capitalizes first letter of each word", () => {
    expect(normalizeAddress("123 main street austin tx")).toBe("123 Main Street Austin Tx");
  });

  it("returns null for empty string", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeAddress(undefined)).toBeNull();
  });
});

describe("Price Normalization", () => {
  it("strips dollar signs and commas", () => {
    expect(normalizePrice("$250,000")).toBe(250_000);
  });

  it("handles price without formatting", () => {
    expect(normalizePrice("75000")).toBe(75_000);
  });

  it("handles decimal prices", () => {
    expect(normalizePrice("$1,250.50")).toBe(1_250.5);
  });

  it("returns null for non-numeric values", () => {
    expect(normalizePrice("ask")).toBeNull();
    expect(normalizePrice("TBD")).toBeNull();
  });

  it("returns null for zero or negative prices", () => {
    expect(normalizePrice("0")).toBeNull();
    expect(normalizePrice("-100")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizePrice(undefined)).toBeNull();
  });
});

describe("Acreage Normalization", () => {
  it("strips 'acres' suffix", () => {
    expect(normalizeAcres("45.5 acres")).toBe(45.5);
  });

  it("strips 'ac' suffix", () => {
    expect(normalizeAcres("100 ac")).toBe(100);
  });

  it("strips 'ac.' suffix", () => {
    expect(normalizeAcres("50 ac.")).toBe(50);
  });

  it("handles number without suffix", () => {
    expect(normalizeAcres("75")).toBe(75);
  });

  it("returns null for zero acreage", () => {
    expect(normalizeAcres("0")).toBeNull();
  });

  it("returns null for non-numeric values", () => {
    expect(normalizeAcres("unknown")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normalizeAcres(undefined)).toBeNull();
  });
});

describe("Deduplication Logic", () => {
  const now = new Date();

  it("removes duplicate records with same parcel number", () => {
    const records: NormalizedRecord[] = [
      { sourceId: 1, address: "123 Main", price: 100_000, acres: 50, owner: null, county: "Travis", state: "TX", parcelNumber: "001-234", scrapedAt: now },
      { sourceId: 2, address: "123 Main St", price: 105_000, acres: 50, owner: null, county: "Travis", state: "TX", parcelNumber: "001-234", scrapedAt: now },
    ];
    expect(deduplicateRecords(records)).toHaveLength(1);
  });

  it("removes duplicate records with same address when no parcel", () => {
    const records: NormalizedRecord[] = [
      { sourceId: 1, address: "456 Oak Ave", price: 200_000, acres: 100, owner: null, county: "Travis", state: "TX", parcelNumber: null, scrapedAt: now },
      { sourceId: 2, address: "456 Oak Ave", price: 200_000, acres: 100, owner: null, county: "Travis", state: "TX", parcelNumber: null, scrapedAt: now },
    ];
    expect(deduplicateRecords(records)).toHaveLength(1);
  });

  it("keeps records from different counties even with same parcel", () => {
    const records: NormalizedRecord[] = [
      { sourceId: 1, address: "A", price: 100_000, acres: 50, owner: null, county: "Travis", state: "TX", parcelNumber: "001", scrapedAt: now },
      { sourceId: 2, address: "B", price: 100_000, acres: 50, owner: null, county: "Hays", state: "TX", parcelNumber: "001", scrapedAt: now },
    ];
    expect(deduplicateRecords(records)).toHaveLength(2);
  });

  it("preserves first occurrence (not second)", () => {
    const records: NormalizedRecord[] = [
      { sourceId: 1, address: "123 Main", price: 100_000, acres: 50, owner: null, county: "Travis", state: "TX", parcelNumber: "X", scrapedAt: now },
      { sourceId: 2, address: "123 Main", price: 200_000, acres: 50, owner: null, county: "Travis", state: "TX", parcelNumber: "X", scrapedAt: now },
    ];
    const deduped = deduplicateRecords(records);
    expect(deduped[0].sourceId).toBe(1);
  });

  it("returns all unique records unchanged", () => {
    const records: NormalizedRecord[] = [
      { sourceId: 1, address: "A", price: 50_000, acres: 25, owner: null, county: "Travis", state: "TX", parcelNumber: "001", scrapedAt: now },
      { sourceId: 2, address: "B", price: 80_000, acres: 40, owner: null, county: "Travis", state: "TX", parcelNumber: "002", scrapedAt: now },
      { sourceId: 3, address: "C", price: 120_000, acres: 60, owner: null, county: "Hays", state: "TX", parcelNumber: "001", scrapedAt: now },
    ];
    expect(deduplicateRecords(records)).toHaveLength(3);
  });
});

describe("Retry Backoff Logic", () => {
  it("first attempt uses base delay", () => {
    expect(computeRetryDelay(1, 1_000)).toBe(1_000);
  });

  it("doubles delay on each attempt (exponential)", () => {
    expect(computeRetryDelay(2, 1_000)).toBe(2_000);
    expect(computeRetryDelay(3, 1_000)).toBe(4_000);
    expect(computeRetryDelay(4, 1_000)).toBe(8_000);
  });

  it("caps delay at maxDelayMs", () => {
    expect(computeRetryDelay(10, 1_000, 30_000)).toBe(30_000);
    expect(computeRetryDelay(20, 1_000, 60_000)).toBe(60_000);
  });

  it("should retry for transient errors below max attempts", () => {
    expect(shouldRetry(1, 3, "timeout").retry).toBe(true);
    expect(shouldRetry(2, 3, "network_error").retry).toBe(true);
  });

  it("should not retry on last attempt", () => {
    const result = shouldRetry(3, 3, "timeout");
    expect(result.retry).toBe(false);
    expect(result.reason).toContain("Max attempts");
  });

  it("should not retry non-retryable errors", () => {
    expect(shouldRetry(1, 5, "auth_failed").retry).toBe(false);
    expect(shouldRetry(1, 5, "blocked_by_site").retry).toBe(false);
    expect(shouldRetry(1, 5, "invalid_target").retry).toBe(false);
  });

  it("provides reason when not retrying", () => {
    const result = shouldRetry(1, 5, "auth_failed");
    expect(result.reason).toContain("not retryable");
  });
});

describe("Health Monitoring", () => {
  const now = new Date();

  it("classifies source as healthy with no failures and fast response", () => {
    const health = computeSourceHealth({
      sourceId: 1,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      lastAttemptAt: now,
      responseTimes: [500, 800, 600],
    });
    expect(health.status).toBe("healthy");
  });

  it("classifies source as degraded with 2+ consecutive failures", () => {
    const health = computeSourceHealth({
      sourceId: 2,
      consecutiveFailures: 2,
      lastSuccessAt: now,
      lastAttemptAt: now,
      responseTimes: [1_000],
    });
    expect(health.status).toBe("degraded");
  });

  it("classifies source as degraded with slow response (>10s)", () => {
    const health = computeSourceHealth({
      sourceId: 3,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      lastAttemptAt: now,
      responseTimes: [12_000, 15_000],
    });
    expect(health.status).toBe("degraded");
  });

  it("classifies source as down with 5+ consecutive failures", () => {
    const health = computeSourceHealth({
      sourceId: 4,
      consecutiveFailures: 5,
      lastSuccessAt: null,
      lastAttemptAt: now,
      responseTimes: [],
    });
    expect(health.status).toBe("down");
  });

  it("computes average response time correctly", () => {
    const health = computeSourceHealth({
      sourceId: 5,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      lastAttemptAt: now,
      responseTimes: [1_000, 2_000, 3_000],
    });
    expect(health.avgResponseMs).toBe(2_000);
  });

  it("filters to healthy sources only by default", () => {
    const sources: SourceHealth[] = [
      { sourceId: 1, consecutiveFailures: 0, lastSuccessAt: now, lastAttemptAt: now, avgResponseMs: 500, status: "healthy" },
      { sourceId: 2, consecutiveFailures: 3, lastSuccessAt: now, lastAttemptAt: now, avgResponseMs: 8_000, status: "degraded" },
      { sourceId: 3, consecutiveFailures: 6, lastSuccessAt: null, lastAttemptAt: now, avgResponseMs: 0, status: "down" },
    ];
    const filtered = filterHealthySources(sources);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].sourceId).toBe(1);
  });

  it("includes degraded sources when allowDegraded=true", () => {
    const sources: SourceHealth[] = [
      { sourceId: 1, consecutiveFailures: 0, lastSuccessAt: now, lastAttemptAt: now, avgResponseMs: 500, status: "healthy" },
      { sourceId: 2, consecutiveFailures: 3, lastSuccessAt: now, lastAttemptAt: now, avgResponseMs: 8_000, status: "degraded" },
      { sourceId: 3, consecutiveFailures: 6, lastSuccessAt: null, lastAttemptAt: now, avgResponseMs: 0, status: "down" },
    ];
    const filtered = filterHealthySources(sources, true);
    expect(filtered).toHaveLength(2);
    expect(filtered.some(s => s.status === "degraded")).toBe(true);
  });
});
