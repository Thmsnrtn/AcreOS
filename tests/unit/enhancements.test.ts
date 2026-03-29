/**
 * Enhancement Services — Unit Tests
 *
 * Tests pure functions from the 16 enhancement service files.
 * DB-dependent functions are excluded; only stateless logic is tested.
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB and schema so module-level imports don't fail
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("@shared/schema", () => ({
  leads: {},
  organizations: {},
  deals: {},
  offers: {},
  campaigns: {},
  marketplaceListings: {},
  notes: {},
  payments: {},
  properties: {},
  activityLog: {},
  featureRequests: {},
  jobHealthLogs: {},
}));

// ── Onboarding Enhancements ──
import {
  detectInvestorType,
  detectColumnMapping,
  detectCsvFormat,
  getNextProfilePrompt,
  suggestStarterCounties,
  detectTimezone,
} from "../../server/services/onboardingEnhancements";

// ── CRM Enhancements ──
import {
  categorizeLeadSource,
  suggestLeadTags,
  explainLeadScore,
} from "../../server/services/crmEnhancements";

// ── Negotiation Enhancements ──
import {
  COUNTER_OFFER_TEMPLATES,
  predictOfferAcceptance,
} from "../../server/services/negotiationEnhancements";

// ── Campaign Enhancements ──
import {
  categorizeResponse,
  getCampaignBenchmarks,
  isHoliday,
} from "../../server/services/campaignEnhancements";

// ── Marketplace Enhancements ──
import {
  calculateListingQuality,
  scoreBuyerIntent,
} from "../../server/services/marketplaceEnhancements";

// ── Reporting Enhancements ──
import {
  tableToCSV,
  getCachedReport,
  cacheReport,
} from "../../server/services/reportingEnhancements";

// ── Pax Enhancements ──
import {
  getPaxSuggestedQuestions,
  calculateROI,
} from "../../server/services/paxEnhancements";

// ── Performance Enhancements ──
import {
  generateETag,
  generateRequestId,
} from "../../server/services/performanceEnhancements";

// ── Security Enhancements ──
import {
  getCSPHeaders,
  isSessionExpired,
  checkLoginRateLimit,
  validateApiScope,
  getSOC2Checklist,
} from "../../server/services/securityEnhancements";

// ── Community Enhancements ──
import {
  searchKnowledgeBase,
  KNOWLEDGE_BASE,
  getWeeklyTip,
  WEEKLY_TIPS,
  getRecentAnnouncements,
  getChangelog,
} from "../../server/services/communityEnhancements";

// ── Finance Enhancements ──
import {
  calculateBundleDiscount,
} from "../../server/services/financeEnhancements";

// ---------------------------------------------------------------------------
// Onboarding Enhancements
// ---------------------------------------------------------------------------

describe("Onboarding Enhancements", () => {
  describe("detectInvestorType", () => {
    it("detects experienced investor from LLC domain", () => {
      expect(detectInvestorType("john@smith-investments.com")).toBe("experienced_investor");
    });
    it("detects experienced investor from capital domain", () => {
      expect(detectInvestorType("jane@bigcapital.com")).toBe("experienced_investor");
    });
    it("detects experienced investor from realty domain", () => {
      expect(detectInvestorType("agent@sunriserealty.com")).toBe("experienced_investor");
    });
    it("detects individual from gmail", () => {
      expect(detectInvestorType("john@gmail.com")).toBe("individual");
    });
    it("detects individual from yahoo", () => {
      expect(detectInvestorType("john@yahoo.com")).toBe("individual");
    });
    it("detects individual from hotmail", () => {
      expect(detectInvestorType("john@hotmail.com")).toBe("individual");
    });
    it("detects individual from outlook", () => {
      expect(detectInvestorType("john@outlook.com")).toBe("individual");
    });
    it("returns unknown for unrecognized domain", () => {
      expect(detectInvestorType("john@company.io")).toBe("unknown");
    });
    it("handles missing @ gracefully", () => {
      expect(detectInvestorType("noemail")).toBe("unknown");
    });
  });

  describe("detectColumnMapping", () => {
    it("maps common CSV headers to AcreOS fields", () => {
      const headers = ["First Name", "Last Name", "Email", "Phone", "APN", "Acreage"];
      const mapping = detectColumnMapping(headers);
      expect(mapping["First Name"]).toBe("firstName");
      expect(mapping["Last Name"]).toBe("lastName");
      expect(mapping["Email"]).toBe("email");
      expect(mapping["Phone"]).toBe("phone");
      expect(mapping["APN"]).toBe("apn");
      expect(mapping["Acreage"]).toBe("acreage");
    });
    it("handles case-insensitive matching", () => {
      const mapping = detectColumnMapping(["FIRST NAME", "email address", "ZIP CODE"]);
      expect(mapping["FIRST NAME"]).toBe("firstName");
      expect(mapping["email address"]).toBe("email");
      expect(mapping["ZIP CODE"]).toBe("zip");
    });
    it("maps property address variants", () => {
      const mapping = detectColumnMapping(["Property Address", "City", "State"]);
      expect(mapping["Property Address"]).toBe("address");
      expect(mapping["City"]).toBe("city");
      expect(mapping["State"]).toBe("state");
    });
    it("maps price-related headers", () => {
      const mapping = detectColumnMapping(["Asking Price", "County"]);
      expect(mapping["Asking Price"]).toBe("askingPrice");
      expect(mapping["County"]).toBe("county");
    });
    it("returns empty mapping for unrecognized headers", () => {
      const mapping = detectColumnMapping(["FooBar", "BazQux"]);
      expect(Object.keys(mapping)).toHaveLength(0);
    });
  });

  describe("detectCsvFormat", () => {
    it("detects Pebble format by pebble_id", () => {
      expect(detectCsvFormat(["pebble_id", "name", "email"])).toBe("pebble");
    });
    it("detects Pebble format by pebble id (with space)", () => {
      expect(detectCsvFormat(["pebble id", "name"])).toBe("pebble");
    });
    it("detects REsimpli format by resimpli_id", () => {
      expect(detectCsvFormat(["resimpli_id", "name", "email"])).toBe("resimpli");
    });
    it("detects REsimpli format by list_stacking_tags", () => {
      expect(detectCsvFormat(["list_stacking_tags", "name"])).toBe("resimpli");
    });
    it("returns generic for unknown formats", () => {
      expect(detectCsvFormat(["name", "email", "phone"])).toBe("generic");
    });
  });

  describe("getNextProfilePrompt", () => {
    it("asks for target counties first when missing", () => {
      const prompt = getNextProfilePrompt({});
      expect(prompt?.field).toBe("targetCounties");
    });
    it("asks for investment goal when counties exist", () => {
      const prompt = getNextProfilePrompt({ targetCounties: ["Travis"] });
      expect(prompt?.field).toBe("investmentGoal");
    });
    it("asks for experience level when goal exists", () => {
      const prompt = getNextProfilePrompt({ targetCounties: ["Travis"], investmentGoal: 5000 });
      expect(prompt?.field).toBe("experienceLevel");
    });
    it("asks for preferred strategy last", () => {
      const prompt = getNextProfilePrompt({
        targetCounties: ["Travis"],
        investmentGoal: 5000,
        experienceLevel: "intermediate",
      });
      expect(prompt?.field).toBe("preferredStrategy");
    });
    it("returns null when profile is complete", () => {
      const prompt = getNextProfilePrompt({
        targetCounties: ["Travis"],
        investmentGoal: 5000,
        experienceLevel: "intermediate",
        preferredStrategy: "wholesale",
      });
      expect(prompt).toBeNull();
    });
  });

  describe("suggestStarterCounties", () => {
    it("returns 3 counties for TX", () => {
      const suggestions = suggestStarterCounties("TX");
      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].state).toBe("TX");
    });
    it("returns 3 counties for FL", () => {
      const suggestions = suggestStarterCounties("FL");
      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].state).toBe("FL");
    });
    it("returns 3 counties for AZ", () => {
      const suggestions = suggestStarterCounties("AZ");
      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].state).toBe("AZ");
    });
    it("returns fallback counties for unknown states", () => {
      const suggestions = suggestStarterCounties("XX");
      expect(suggestions).toHaveLength(3);
    });
    it("handles lowercase state codes", () => {
      const suggestions = suggestStarterCounties("tx");
      expect(suggestions).toHaveLength(3);
      expect(suggestions[0].state).toBe("tx");
    });
  });

  describe("detectTimezone", () => {
    it("maps EST offset (300) correctly", () => {
      expect(detectTimezone(300)).toBe("America/New_York");
    });
    it("maps CST offset (360) correctly", () => {
      expect(detectTimezone(360)).toBe("America/Chicago");
    });
    it("maps MST offset (420) correctly", () => {
      expect(detectTimezone(420)).toBe("America/Denver");
    });
    it("maps PST offset (480) correctly", () => {
      expect(detectTimezone(480)).toBe("America/Los_Angeles");
    });
    it("maps AKST offset (540) correctly", () => {
      expect(detectTimezone(540)).toBe("America/Anchorage");
    });
    it("maps HST offset (600) correctly", () => {
      expect(detectTimezone(600)).toBe("Pacific/Honolulu");
    });
    it("falls back to Chicago for unknown offsets", () => {
      expect(detectTimezone(999)).toBe("America/Chicago");
    });
  });
});

// ---------------------------------------------------------------------------
// CRM Enhancements
// ---------------------------------------------------------------------------

describe("CRM Enhancements", () => {
  describe("categorizeLeadSource", () => {
    it("categorizes CSV import", () => {
      expect(categorizeLeadSource("csv_import")).toBe("csv_import");
    });
    it("categorizes deal feed", () => {
      expect(categorizeLeadSource("deal_feed")).toBe("deal_feed");
    });
    it("categorizes manual entry", () => {
      expect(categorizeLeadSource("manual_entry")).toBe("manual_entry");
    });
    it("categorizes referral", () => {
      expect(categorizeLeadSource("referral")).toBe("referral");
    });
    it("categorizes campaign", () => {
      expect(categorizeLeadSource("campaign")).toBe("campaign");
    });
    it("categorizes sample", () => {
      expect(categorizeLeadSource("sample")).toBe("sample");
    });
    it("returns unknown for null", () => {
      expect(categorizeLeadSource(null)).toBe("unknown");
    });
    it("returns other for unrecognized sources", () => {
      expect(categorizeLeadSource("random_source")).toBe("other");
    });
  });

  describe("suggestLeadTags", () => {
    it("tags high motivation leads", () => {
      const tags = suggestLeadTags({ motivationScore: 85, phone: "555-1234", email: "a@b.com", county: "Travis" });
      expect(tags).toContain("high-motivation");
      expect(tags).toContain("full-contact");
      expect(tags).toContain("travis");
    });
    it("tags large parcels", () => {
      const tags = suggestLeadTags({ acreage: 50 });
      expect(tags).toContain("large-parcel");
    });
    it("tags small lots", () => {
      const tags = suggestLeadTags({ acreage: 2 });
      expect(tags).toContain("small-lot");
    });
    it("tags engaged leads", () => {
      const tags = suggestLeadTags({ status: "responded" });
      expect(tags).toContain("engaged");
    });
    it("returns empty array for empty lead", () => {
      const tags = suggestLeadTags({});
      expect(tags).toHaveLength(0);
    });
  });

  describe("explainLeadScore", () => {
    it("explains high motivation factor", () => {
      const factors = explainLeadScore({ motivationScore: 80, phone: "555", email: "a@b.com" });
      expect(factors.some(f => f.factor === "Motivation")).toBe(true);
      expect(factors.some(f => f.factor === "Contact Info")).toBe(true);
    });
    it("explains moderate motivation", () => {
      const factors = explainLeadScore({ motivationScore: 50 });
      expect(factors.some(f => f.factor === "Motivation" && f.impact === 15)).toBe(true);
    });
    it("explains tax delinquent factor", () => {
      const factors = explainLeadScore({ taxDelinquent: true });
      expect(factors.some(f => f.factor === "Tax Status")).toBe(true);
    });
    it("explains absentee owner factor", () => {
      const factors = explainLeadScore({ absenteeOwner: true });
      expect(factors.some(f => f.factor === "Ownership")).toBe(true);
    });
    it("explains partial contact info", () => {
      const factors = explainLeadScore({ phone: "555" });
      expect(factors.some(f => f.factor === "Contact Info" && f.impact === 5)).toBe(true);
    });
    it("returns empty for lead with no signals", () => {
      const factors = explainLeadScore({});
      expect(factors).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Negotiation Enhancements
// ---------------------------------------------------------------------------

describe("Negotiation Enhancements", () => {
  it("has 3 counter-offer templates", () => {
    expect(Object.keys(COUNTER_OFFER_TEMPLATES)).toHaveLength(3);
    expect(COUNTER_OFFER_TEMPLATES.firm).toBeDefined();
    expect(COUNTER_OFFER_TEMPLATES.flexible).toBeDefined();
    expect(COUNTER_OFFER_TEMPLATES.walkaway).toBeDefined();
  });

  it("each template has name, tone, and template text", () => {
    for (const key of Object.keys(COUNTER_OFFER_TEMPLATES)) {
      const tpl = COUNTER_OFFER_TEMPLATES[key];
      expect(tpl.name).toBeTruthy();
      expect(tpl.tone).toBeTruthy();
      expect(tpl.template).toBeTruthy();
      expect(tpl.template.length).toBeGreaterThan(20);
    }
  });

  describe("predictOfferAcceptance", () => {
    it("predicts higher probability for high motivation + high offer", () => {
      const result = predictOfferAcceptance(90, 85);
      expect(result.probability).toBeGreaterThan(60);
      expect(result.confidence).toBe("high");
    });
    it("predicts lower probability for low motivation + low offer", () => {
      const result = predictOfferAcceptance(20, 30);
      expect(result.probability).toBeLessThan(40);
    });
    it("clamps probability to max 95", () => {
      const high = predictOfferAcceptance(100, 100);
      expect(high.probability).toBeLessThanOrEqual(95);
    });
    it("clamps probability to min 5", () => {
      const low = predictOfferAcceptance(0, 0);
      expect(low.probability).toBeGreaterThanOrEqual(5);
    });
    it("returns medium confidence for mid-range probability", () => {
      const result = predictOfferAcceptance(50, 65);
      expect(result.confidence).toBe("medium");
    });
    it("includes factors explaining the prediction", () => {
      const result = predictOfferAcceptance(90, 90);
      expect(result.factors.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Campaign Enhancements
// ---------------------------------------------------------------------------

describe("Campaign Enhancements", () => {
  describe("categorizeResponse", () => {
    it("detects interested responses", () => {
      expect(categorizeResponse("Yes, I'm interested in selling")).toBe("interested");
    });
    it("detects 'tell me more' as interested", () => {
      expect(categorizeResponse("Can you tell me more about this?")).toBe("interested");
    });
    it("detects not interested responses", () => {
      // "not interested" also contains "interested", but the check for
      // "not interested" substring fires first in the implementation
      expect(categorizeResponse("No thanks, please remove me")).toBe("not_interested");
    });
    it("detects stop as not interested", () => {
      expect(categorizeResponse("Please stop sending mail")).toBe("not_interested");
    });
    it("detects wrong number", () => {
      expect(categorizeResponse("Wrong number, I don't own that property")).toBe("wrong_number");
    });
    it("detects angry responses via lawyer keyword", () => {
      expect(categorizeResponse("I'm calling my lawyer")).toBe("angry");
    });
    it("detects harassment complaints as angry", () => {
      expect(categorizeResponse("This is harassment")).toBe("angry");
    });
    it("detects questions", () => {
      expect(categorizeResponse("What price are you offering?")).toBe("question");
    });
    it("returns unknown for ambiguous text", () => {
      expect(categorizeResponse("ok")).toBe("unknown");
    });
  });

  it("returns valid campaign benchmarks", () => {
    const b = getCampaignBenchmarks();
    expect(b.avgOpenRate).toBeGreaterThan(0);
    expect(b.avgResponseRate).toBeGreaterThan(0);
    expect(b.avgConversionRate).toBeGreaterThan(0);
  });

  describe("isHoliday", () => {
    it("detects New Year's Day", () => {
      expect(isHoliday(new Date(2026, 0, 1))).toBe(true);
    });
    it("detects Independence Day", () => {
      expect(isHoliday(new Date(2026, 6, 4))).toBe(true);
    });
    it("detects Christmas", () => {
      expect(isHoliday(new Date(2026, 11, 25))).toBe(true);
    });
    it("detects New Year's Eve", () => {
      expect(isHoliday(new Date(2026, 11, 31))).toBe(true);
    });
    it("returns false for regular days", () => {
      expect(isHoliday(new Date(2026, 2, 15))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Marketplace Enhancements
// ---------------------------------------------------------------------------

describe("Marketplace Enhancements", () => {
  describe("calculateListingQuality", () => {
    it("gives high score for complete listing", () => {
      const result = calculateListingQuality({
        title: "Great property",
        description: "A wonderful 5-acre parcel in beautiful Travis County with road access and utilities nearby.",
        price: 25000,
        acreage: 5,
        county: "Travis",
        state: "TX",
        photos: ["photo1.jpg"],
        latitude: 30.5,
      });
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.missing).toHaveLength(0);
    });
    it("gives bonus for seller financing", () => {
      const without = calculateListingQuality({
        title: "Prop",
        description: "A wonderful 5-acre parcel in beautiful Travis County with road access and utilities nearby.",
        price: 25000,
        acreage: 5,
        county: "Travis",
        state: "TX",
        photos: ["photo1.jpg"],
        latitude: 30.5,
      });
      const with_ = calculateListingQuality({
        title: "Prop",
        description: "A wonderful 5-acre parcel in beautiful Travis County with road access and utilities nearby.",
        price: 25000,
        acreage: 5,
        county: "Travis",
        state: "TX",
        photos: ["photo1.jpg"],
        latitude: 30.5,
        sellerFinancing: true,
      });
      expect(with_.score).toBe(without.score + 5);
    });
    it("lists missing fields for incomplete listing", () => {
      const result = calculateListingQuality({});
      expect(result.score).toBeLessThan(20);
      expect(result.missing.length).toBeGreaterThan(4);
    });
    it("penalizes short descriptions", () => {
      const result = calculateListingQuality({ description: "Short" });
      expect(result.missing).toContain("detailed description");
    });
  });

  describe("scoreBuyerIntent", () => {
    it("scores high for active buyers", () => {
      const score = scoreBuyerIntent({ views: 10, saves: 3, offers: 1, daysActive: 3 });
      expect(score).toBeGreaterThan(60);
    });
    it("scores low for passive viewers", () => {
      const score = scoreBuyerIntent({ views: 2, saves: 0, offers: 0, daysActive: 30 });
      expect(score).toBeLessThan(20);
    });
    it("caps score at 100", () => {
      const score = scoreBuyerIntent({ views: 100, saves: 50, offers: 10, daysActive: 1 });
      expect(score).toBeLessThanOrEqual(100);
    });
    it("gives recent activity bonus", () => {
      const recent = scoreBuyerIntent({ views: 5, saves: 0, offers: 0, daysActive: 3 });
      const old = scoreBuyerIntent({ views: 5, saves: 0, offers: 0, daysActive: 30 });
      expect(recent).toBeGreaterThan(old);
    });
  });
});

// ---------------------------------------------------------------------------
// Reporting Enhancements
// ---------------------------------------------------------------------------

describe("Reporting Enhancements", () => {
  describe("tableToCSV", () => {
    it("converts array of objects to CSV", () => {
      const csv = tableToCSV([
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ]);
      expect(csv).toContain("name,age");
      expect(csv).toContain("Alice,30");
      expect(csv).toContain("Bob,25");
    });
    it("handles commas in values", () => {
      const csv = tableToCSV([{ name: "Smith, Jr.", age: 40 }]);
      expect(csv).toContain('"Smith, Jr."');
    });
    it("handles quotes in values", () => {
      const csv = tableToCSV([{ name: 'He said "hi"' }]);
      expect(csv).toContain('"He said ""hi"""');
    });
    it("handles null/undefined values", () => {
      const csv = tableToCSV([{ name: "Alice", age: null }]);
      expect(csv).toContain("Alice,");
    });
    it("returns empty string for empty array", () => {
      expect(tableToCSV([])).toBe("");
    });
    it("respects custom column selection", () => {
      const csv = tableToCSV([{ name: "Alice", age: 30, city: "Austin" }], ["name", "city"]);
      expect(csv).toContain("name,city");
      expect(csv).not.toContain("age");
    });
  });

  describe("report caching", () => {
    it("caches and retrieves reports", () => {
      cacheReport("test-key-enhancements", { data: "hello" }, 60000);
      expect(getCachedReport("test-key-enhancements")).toEqual({ data: "hello" });
    });
    it("returns null for missing keys", () => {
      expect(getCachedReport("nonexistent-key-xyz")).toBeNull();
    });
    it("returns null for expired cache entries", () => {
      cacheReport("expired-key", { data: "old" }, 1); // 1ms TTL
      // Wait a tiny bit for expiry
      const start = Date.now();
      while (Date.now() - start < 5) { /* spin */ }
      expect(getCachedReport("expired-key")).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Pax Enhancements
// ---------------------------------------------------------------------------

describe("Pax Enhancements", () => {
  describe("getPaxSuggestedQuestions", () => {
    it("returns questions for /today page", () => {
      const q = getPaxSuggestedQuestions("/today");
      expect(q.length).toBeGreaterThan(0);
    });
    it("returns questions for /pipeline page", () => {
      const q = getPaxSuggestedQuestions("/pipeline");
      expect(q.length).toBeGreaterThan(0);
    });
    it("returns questions for /leads page", () => {
      const q = getPaxSuggestedQuestions("/leads");
      expect(q.length).toBeGreaterThan(0);
    });
    it("returns questions for /deals page", () => {
      const q = getPaxSuggestedQuestions("/deals");
      expect(q.length).toBeGreaterThan(0);
    });
    it("returns default questions for unknown pages", () => {
      const q = getPaxSuggestedQuestions("/random");
      expect(q.length).toBeGreaterThan(0);
    });
  });

  describe("calculateROI", () => {
    it("calculates correct ROI", () => {
      const result = calculateROI(2400, 8200, 400);
      expect(result.profit).toBe(5400);
      expect(result.roi).toBe(193); // (5400/2800)*100 = 192.86 -> rounds to 193
    });
    it("calculates correct margin", () => {
      const result = calculateROI(2000, 10000, 0);
      expect(result.margin).toBe(80); // 8000/10000*100
    });
    it("handles zero buy price", () => {
      const result = calculateROI(0, 1000);
      expect(result.roi).toBe(0);
    });
    it("handles zero sell price", () => {
      const result = calculateROI(1000, 0);
      expect(result.margin).toBe(0);
    });
    it("handles closing costs", () => {
      const result = calculateROI(5000, 10000, 1000);
      expect(result.profit).toBe(4000);
      expect(result.roi).toBe(67); // 4000/6000*100
    });
  });
});

// ---------------------------------------------------------------------------
// Performance Enhancements
// ---------------------------------------------------------------------------

describe("Performance Enhancements", () => {
  it("generates consistent ETags for same data", () => {
    const data = { id: 1, name: "test" };
    const tag1 = generateETag(data);
    const tag2 = generateETag(data);
    expect(tag1).toBe(tag2);
  });

  it("generates different ETags for different data", () => {
    const tag1 = generateETag({ a: 1 });
    const tag2 = generateETag({ a: 2 });
    expect(tag1).not.toBe(tag2);
  });

  it("ETag is wrapped in quotes", () => {
    const tag = generateETag({ test: true });
    expect(tag).toMatch(/^".*"$/);
  });

  it("generates unique request IDs", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^req_/);
  });

  it("request IDs have expected format", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_[a-z0-9]+_[a-z0-9]+$/);
  });
});

// ---------------------------------------------------------------------------
// Security Enhancements
// ---------------------------------------------------------------------------

describe("Security Enhancements", () => {
  it("returns CSP headers with required directives", () => {
    const headers = getCSPHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src");
    expect(headers["Content-Security-Policy"]).toContain("script-src");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-XSS-Protection"]).toBe("1; mode=block");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  describe("isSessionExpired", () => {
    it("returns false for recent activity", () => {
      expect(isSessionExpired(new Date())).toBe(false);
    });
    it("returns true for old activity (> 24h default)", () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      expect(isSessionExpired(old)).toBe(true);
    });
    it("respects custom max inactive hours", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(isSessionExpired(twoHoursAgo, 1)).toBe(true);
      expect(isSessionExpired(twoHoursAgo, 3)).toBe(false);
    });
  });

  describe("checkLoginRateLimit", () => {
    it("allows first attempt", () => {
      const result = checkLoginRateLimit("192.168.1.200");
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
    it("tracks remaining attempts", () => {
      const ip = "192.168.1.201";
      checkLoginRateLimit(ip);
      const second = checkLoginRateLimit(ip);
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(3);
    });
    it("blocks after max attempts", () => {
      const ip = "192.168.1.202";
      for (let i = 0; i < 5; i++) checkLoginRateLimit(ip);
      const result = checkLoginRateLimit(ip);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe("validateApiScope", () => {
    it("allows wildcard scope", () => {
      expect(validateApiScope("leads:read", ["*"])).toBe(true);
    });
    it("allows exact scope match", () => {
      expect(validateApiScope("leads:read", ["leads:read"])).toBe(true);
    });
    it("allows resource wildcard", () => {
      expect(validateApiScope("leads:read", ["leads:*"])).toBe(true);
    });
    it("rejects missing scope", () => {
      expect(validateApiScope("leads:write", ["leads:read"])).toBe(false);
    });
    it("rejects wrong resource", () => {
      expect(validateApiScope("deals:read", ["leads:*"])).toBe(false);
    });
    it("allows one of multiple scopes", () => {
      expect(validateApiScope("deals:read", ["leads:read", "deals:read"])).toBe(true);
    });
  });

  it("returns SOC2 checklist with all categories", () => {
    const checklist = getSOC2Checklist();
    expect(checklist.length).toBeGreaterThan(5);
    expect(checklist.some(c => c.category === "Security")).toBe(true);
    expect(checklist.some(c => c.category === "Privacy")).toBe(true);
    expect(checklist.some(c => c.category === "Availability")).toBe(true);
    // Each entry has required fields
    for (const item of checklist) {
      expect(item).toHaveProperty("control");
      expect(item).toHaveProperty("category");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("notes");
    }
  });
});

// ---------------------------------------------------------------------------
// Community Enhancements
// ---------------------------------------------------------------------------

describe("Community Enhancements", () => {
  it("has knowledge base articles", () => {
    expect(KNOWLEDGE_BASE.length).toBeGreaterThan(5);
  });

  it("each article has required fields", () => {
    for (const article of KNOWLEDGE_BASE) {
      expect(article).toHaveProperty("id");
      expect(article).toHaveProperty("title");
      expect(article).toHaveProperty("category");
      expect(article).toHaveProperty("content");
      expect(article).toHaveProperty("keywords");
    }
  });

  describe("searchKnowledgeBase", () => {
    it("finds articles by keyword", () => {
      const results = searchKnowledgeBase("import");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe("import-leads");
    });
    it("finds articles by title", () => {
      const results = searchKnowledgeBase("Getting Started");
      expect(results.length).toBeGreaterThan(0);
    });
    it("finds articles by content keyword", () => {
      const results = searchKnowledgeBase("Pax");
      expect(results.length).toBeGreaterThan(0);
    });
    it("returns empty for no matches", () => {
      expect(searchKnowledgeBase("xyznonexistent")).toHaveLength(0);
    });
  });

  it("has weekly tips", () => {
    expect(WEEKLY_TIPS.length).toBeGreaterThan(5);
  });

  it("returns a weekly tip as non-empty string", () => {
    const tip = getWeeklyTip();
    expect(typeof tip).toBe("string");
    expect(tip.length).toBeGreaterThan(10);
  });

  it("returns recent announcements with required fields", () => {
    const announcements = getRecentAnnouncements();
    expect(announcements.length).toBeGreaterThan(0);
    for (const a of announcements) {
      expect(a).toHaveProperty("id");
      expect(a).toHaveProperty("title");
      expect(a).toHaveProperty("description");
      expect(a).toHaveProperty("date");
      expect(a).toHaveProperty("category");
    }
  });

  it("returns changelog entries with required fields", () => {
    const changelog = getChangelog();
    expect(changelog.length).toBeGreaterThan(0);
    expect(changelog[0]).toHaveProperty("week");
    expect(changelog[0].entries.length).toBeGreaterThan(0);
    for (const entry of changelog[0].entries) {
      expect(entry).toHaveProperty("title");
      expect(entry).toHaveProperty("type");
    }
  });
});

// ---------------------------------------------------------------------------
// Finance Enhancements
// ---------------------------------------------------------------------------

describe("Finance Enhancements", () => {
  describe("calculateBundleDiscount", () => {
    it("calculates discounted price for note pool", () => {
      const result = calculateBundleDiscount([
        { balance: 10000, rate: 0.10, monthsRemaining: 60 },
        { balance: 15000, rate: 0.12, monthsRemaining: 48 },
      ]);
      expect(result.totalBalance).toBe(25000);
      expect(result.discountedPrice).toBeLessThan(25000);
      expect(result.discountedPrice).toBe(20000); // 80% of 25000
      expect(result.yield).toBeGreaterThan(0);
    });
    it("handles single note", () => {
      const result = calculateBundleDiscount([
        { balance: 10000, rate: 0.08, monthsRemaining: 36 },
      ]);
      expect(result.totalBalance).toBe(10000);
      expect(result.discountedPrice).toBe(8000);
    });
    it("calculates yield as boosted average rate", () => {
      const result = calculateBundleDiscount([
        { balance: 10000, rate: 0.10, monthsRemaining: 60 },
      ]);
      // yield = avgRate * 1.25 = 0.10 * 1.25 = 0.125 -> rounded to 0.13
      expect(result.yield).toBe(0.13);
    });
  });
});
