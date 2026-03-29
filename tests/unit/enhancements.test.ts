import { describe, it, expect } from "vitest";

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
  getRecentAnnouncements,
  getChangelog,
} from "../../server/services/communityEnhancements";

// ── Finance Enhancements ──
import {
  calculateBundleDiscount,
} from "../../server/services/financeEnhancements";

// ═══════════════════════════════════════════════════════════
// A. Onboarding Enhancements (Items 1-15)
// ═══════════════════════════════════════════════════════════

describe("Onboarding Enhancements", () => {
  describe("detectInvestorType", () => {
    it("detects experienced investor from LLC/investment domain", () => {
      expect(detectInvestorType("john@smith-investments.com")).toBe("experienced_investor");
      expect(detectInvestorType("team@txlandholdings.com")).toBe("experienced_investor");
    });
    it("detects individual from consumer email", () => {
      expect(detectInvestorType("john@gmail.com")).toBe("individual");
      expect(detectInvestorType("jane@yahoo.com")).toBe("individual");
    });
    it("returns unknown for unrecognized domain", () => {
      expect(detectInvestorType("john@company.io")).toBe("unknown");
    });
  });

  describe("detectColumnMapping", () => {
    it("maps standard CSV headers to AcreOS fields", () => {
      const mapping = detectColumnMapping(["First Name", "Last Name", "Email", "Phone", "APN", "Acreage"]);
      expect(mapping["First Name"]).toBe("firstName");
      expect(mapping["Last Name"]).toBe("lastName");
      expect(mapping["Email"]).toBe("email");
      expect(mapping["APN"]).toBe("apn");
    });
    it("handles case-insensitive matching", () => {
      const mapping = detectColumnMapping(["FIRST NAME", "email address", "ZIP CODE"]);
      expect(mapping["FIRST NAME"]).toBe("firstName");
      expect(mapping["email address"]).toBe("email");
      expect(mapping["ZIP CODE"]).toBe("zip");
    });
    it("skips unmappable headers", () => {
      const mapping = detectColumnMapping(["Random Column", "Email"]);
      expect(mapping["Random Column"]).toBeUndefined();
      expect(mapping["Email"]).toBe("email");
    });
  });

  describe("detectCsvFormat", () => {
    it("detects Pebble format", () => {
      expect(detectCsvFormat(["pebble_id", "name"])).toBe("pebble");
    });
    it("detects REsimpli format", () => {
      expect(detectCsvFormat(["list_stacking_tags", "name"])).toBe("resimpli");
    });
    it("returns generic for unknown formats", () => {
      expect(detectCsvFormat(["name", "email"])).toBe("generic");
    });
  });

  describe("getNextProfilePrompt", () => {
    it("prompts for target counties first", () => {
      expect(getNextProfilePrompt({})?.field).toBe("targetCounties");
    });
    it("prompts for goal when counties present", () => {
      expect(getNextProfilePrompt({ targetCounties: ["Travis"] })?.field).toBe("investmentGoal");
    });
    it("returns null when profile complete", () => {
      expect(getNextProfilePrompt({ targetCounties: ["TX"], investmentGoal: 5000, experienceLevel: "mid", preferredStrategy: "wholesale" })).toBeNull();
    });
  });

  describe("suggestStarterCounties", () => {
    it("returns 3 counties for TX", () => {
      const result = suggestStarterCounties("TX");
      expect(result).toHaveLength(3);
      expect(result[0].state).toBe("TX");
    });
    it("returns fallbacks for unknown state", () => {
      expect(suggestStarterCounties("ZZ")).toHaveLength(3);
    });
  });

  describe("detectTimezone", () => {
    it("maps offsets correctly", () => {
      expect(detectTimezone(300)).toBe("America/New_York");
      expect(detectTimezone(480)).toBe("America/Los_Angeles");
    });
    it("falls back to Chicago", () => {
      expect(detectTimezone(999)).toBe("America/Chicago");
    });
  });
});

// ═══════════════════════════════════════════════════════════
// D. CRM Enhancements (Items 51-70)
// ═══════════════════════════════════════════════════════════

describe("CRM Enhancements", () => {
  describe("categorizeLeadSource", () => {
    it("categorizes known sources", () => {
      expect(categorizeLeadSource("csv_import")).toBe("csv_import");
      expect(categorizeLeadSource("deal_feed")).toBe("deal_feed");
      expect(categorizeLeadSource("manual_entry")).toBe("manual_entry");
      expect(categorizeLeadSource("referral")).toBe("referral");
    });
    it("returns unknown for null", () => {
      expect(categorizeLeadSource(null)).toBe("unknown");
    });
  });

  describe("suggestLeadTags", () => {
    it("tags high motivation and full contact", () => {
      const tags = suggestLeadTags({ motivationScore: 85, phone: "555", email: "a@b.com", county: "Travis" });
      expect(tags).toContain("high-motivation");
      expect(tags).toContain("full-contact");
      expect(tags).toContain("travis");
    });
    it("tags large parcels", () => {
      expect(suggestLeadTags({ acreage: 50 })).toContain("large-parcel");
    });
    it("tags small lots", () => {
      expect(suggestLeadTags({ acreage: 2 })).toContain("small-lot");
    });
  });

  describe("explainLeadScore", () => {
    it("explains motivation and contact factors", () => {
      const factors = explainLeadScore({ motivationScore: 80, phone: "555", email: "a@b.com" });
      expect(factors.some(f => f.factor === "Motivation")).toBe(true);
      expect(factors.some(f => f.factor === "Contact Info")).toBe(true);
    });
    it("explains tax delinquency", () => {
      const factors = explainLeadScore({ taxDelinquent: true });
      expect(factors.some(f => f.factor === "Tax Status" && f.impact === 20)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// E. Negotiation Enhancements (Items 71-85)
// ═══════════════════════════════════════════════════════════

describe("Negotiation Enhancements", () => {
  it("has 3 counter-offer templates with required fields", () => {
    expect(Object.keys(COUNTER_OFFER_TEMPLATES)).toHaveLength(3);
    for (const tmpl of Object.values(COUNTER_OFFER_TEMPLATES)) {
      expect(tmpl).toHaveProperty("name");
      expect(tmpl).toHaveProperty("tone");
      expect(tmpl).toHaveProperty("template");
      expect(tmpl.template.length).toBeGreaterThan(50);
    }
  });

  describe("predictOfferAcceptance", () => {
    it("predicts high probability for motivated seller + strong offer", () => {
      const result = predictOfferAcceptance(90, 85);
      expect(result.probability).toBeGreaterThan(60);
      expect(result.confidence).toBe("high");
      expect(result.factors.length).toBeGreaterThan(0);
    });
    it("predicts low probability for unmotivated seller + weak offer", () => {
      const result = predictOfferAcceptance(20, 30);
      expect(result.probability).toBeLessThan(40);
    });
    it("clamps between 5 and 95", () => {
      expect(predictOfferAcceptance(100, 100).probability).toBeLessThanOrEqual(95);
      expect(predictOfferAcceptance(0, 0).probability).toBeGreaterThanOrEqual(5);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// G. Campaign Enhancements (Items 106-125)
// ═══════════════════════════════════════════════════════════

describe("Campaign Enhancements", () => {
  describe("categorizeResponse", () => {
    it("detects interested", () => expect(categorizeResponse("Yes, I'm interested")).toBe("interested"));
    it("detects not interested", () => expect(categorizeResponse("No thanks")).toBe("not_interested"));
    it("detects wrong number", () => expect(categorizeResponse("Wrong number")).toBe("wrong_number"));
    it("detects angry", () => expect(categorizeResponse("I will sue you for harassment")).toBe("angry"));
    it("detects question", () => expect(categorizeResponse("What price?")).toBe("question"));
    it("returns unknown for ambiguous", () => expect(categorizeResponse("ok")).toBe("unknown"));
  });

  it("returns valid benchmarks", () => {
    const b = getCampaignBenchmarks();
    expect(b.avgOpenRate).toBeGreaterThan(0);
    expect(b.avgResponseRate).toBeGreaterThan(0);
    expect(b.avgConversionRate).toBeGreaterThan(0);
  });

  describe("isHoliday", () => {
    it("detects major holidays", () => {
      expect(isHoliday(new Date(2026, 11, 25))).toBe(true); // Christmas
      expect(isHoliday(new Date(2026, 0, 1))).toBe(true);   // New Year
      expect(isHoliday(new Date(2026, 6, 4))).toBe(true);   // July 4th
    });
    it("returns false for regular days", () => {
      expect(isHoliday(new Date(2026, 2, 15))).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// H. Marketplace Enhancements (Items 126-140)
// ═══════════════════════════════════════════════════════════

describe("Marketplace Enhancements", () => {
  describe("calculateListingQuality", () => {
    it("gives high score for complete listing", () => {
      const result = calculateListingQuality({
        title: "Great property", description: "A wonderful 5-acre parcel with road access and utilities nearby.",
        price: 25000, acreage: 5, county: "Travis", state: "TX",
        photos: ["photo1.jpg"], latitude: 30.5,
      });
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.missing).toHaveLength(0);
    });
    it("lists missing fields for empty listing", () => {
      const result = calculateListingQuality({});
      expect(result.score).toBeLessThan(20);
      expect(result.missing.length).toBeGreaterThan(4);
    });
  });

  describe("scoreBuyerIntent", () => {
    it("high score for active buyer", () => {
      expect(scoreBuyerIntent({ views: 10, saves: 3, offers: 1, daysActive: 3 })).toBeGreaterThan(60);
    });
    it("low score for passive viewer", () => {
      expect(scoreBuyerIntent({ views: 2, saves: 0, offers: 0, daysActive: 30 })).toBeLessThan(20);
    });
    it("caps at 100", () => {
      expect(scoreBuyerIntent({ views: 100, saves: 50, offers: 10, daysActive: 1 })).toBeLessThanOrEqual(100);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// I. Reporting Enhancements (Items 141-160)
// ═══════════════════════════════════════════════════════════

describe("Reporting Enhancements", () => {
  describe("tableToCSV", () => {
    it("converts objects to CSV string", () => {
      const csv = tableToCSV([{ name: "Alice", age: 30 }, { name: "Bob", age: 25 }]);
      expect(csv).toContain("name,age");
      expect(csv).toContain("Alice,30");
      expect(csv).toContain("Bob,25");
    });
    it("escapes commas in values", () => {
      const csv = tableToCSV([{ name: "Smith, Jr.", age: 40 }]);
      expect(csv).toContain('"Smith, Jr."');
    });
    it("returns empty for empty input", () => {
      expect(tableToCSV([])).toBe("");
    });
  });

  describe("report caching", () => {
    it("stores and retrieves cached reports", () => {
      cacheReport("test-cache-key", { data: "hello" }, 60000);
      expect(getCachedReport("test-cache-key")).toEqual({ data: "hello" });
    });
    it("returns null for missing keys", () => {
      expect(getCachedReport("nonexistent-key")).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════
// J. Pax Enhancements (Items 161-180)
// ═══════════════════════════════════════════════════════════

describe("Pax Enhancements", () => {
  describe("getPaxSuggestedQuestions", () => {
    it("returns page-specific questions", () => {
      const today = getPaxSuggestedQuestions("/today");
      expect(today.length).toBeGreaterThan(0);
      const pipeline = getPaxSuggestedQuestions("/pipeline");
      expect(pipeline.length).toBeGreaterThan(0);
      expect(today).not.toEqual(pipeline);
    });
    it("returns default questions for unknown pages", () => {
      expect(getPaxSuggestedQuestions("/random").length).toBeGreaterThan(0);
    });
  });

  describe("calculateROI", () => {
    it("calculates profit, ROI, and margin correctly", () => {
      const result = calculateROI(2400, 8200, 400);
      expect(result.profit).toBe(5400);
      expect(result.roi).toBe(193);
      expect(result.margin).toBe(66);
    });
    it("handles zero buy price gracefully", () => {
      expect(calculateROI(0, 1000).roi).toBe(0);
    });
    it("handles zero sell price", () => {
      expect(calculateROI(1000, 0).margin).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// L. Performance Enhancements (Items 201-220)
// ═══════════════════════════════════════════════════════════

describe("Performance Enhancements", () => {
  it("generates consistent ETags for same data", () => {
    const tag1 = generateETag({ id: 1, name: "test" });
    const tag2 = generateETag({ id: 1, name: "test" });
    expect(tag1).toBe(tag2);
  });

  it("generates different ETags for different data", () => {
    expect(generateETag({ a: 1 })).not.toBe(generateETag({ a: 2 }));
  });

  it("generates unique request IDs with prefix", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^req_/);
    expect(id2).toMatch(/^req_/);
  });
});

// ═══════════════════════════════════════════════════════════
// M. Security Enhancements (Items 221-240)
// ═══════════════════════════════════════════════════════════

describe("Security Enhancements", () => {
  it("returns CSP headers with all required directives", () => {
    const h = getCSPHeaders();
    expect(h["Content-Security-Policy"]).toContain("default-src");
    expect(h["Content-Security-Policy"]).toContain("stripe.com");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
  });

  describe("isSessionExpired", () => {
    it("not expired for recent activity", () => expect(isSessionExpired(new Date())).toBe(false));
    it("expired after 25 hours", () => expect(isSessionExpired(new Date(Date.now() - 25 * 3600000))).toBe(true));
    it("respects custom max hours", () => expect(isSessionExpired(new Date(Date.now() - 2 * 3600000), 1)).toBe(true));
  });

  describe("checkLoginRateLimit", () => {
    it("allows first attempt from new IP", () => {
      const result = checkLoginRateLimit("10.0.0." + Math.floor(Math.random() * 255));
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  describe("validateApiScope", () => {
    it("allows wildcard", () => expect(validateApiScope("leads:read", ["*"])).toBe(true));
    it("allows exact match", () => expect(validateApiScope("leads:read", ["leads:read"])).toBe(true));
    it("allows resource wildcard", () => expect(validateApiScope("leads:write", ["leads:*"])).toBe(true));
    it("rejects missing scope", () => expect(validateApiScope("leads:write", ["deals:read"])).toBe(false));
  });

  it("has SOC2 checklist with Security and Privacy", () => {
    const list = getSOC2Checklist();
    expect(list.length).toBeGreaterThan(5);
    expect(list.some(c => c.category === "Security")).toBe(true);
    expect(list.some(c => c.category === "Privacy")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// P. Community Enhancements (Items 281-300)
// ═══════════════════════════════════════════════════════════

describe("Community Enhancements", () => {
  it("has 8+ knowledge base articles", () => {
    expect(KNOWLEDGE_BASE.length).toBeGreaterThanOrEqual(8);
  });

  describe("searchKnowledgeBase", () => {
    it("finds articles by keyword", () => {
      const results = searchKnowledgeBase("import");
      expect(results.length).toBeGreaterThan(0);
    });
    it("returns empty for no matches", () => {
      expect(searchKnowledgeBase("xyznonexistent")).toHaveLength(0);
    });
  });

  it("returns a non-empty weekly tip", () => {
    const tip = getWeeklyTip();
    expect(typeof tip).toBe("string");
    expect(tip.length).toBeGreaterThan(10);
  });

  it("returns announcements with required fields", () => {
    const a = getRecentAnnouncements();
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]).toHaveProperty("title");
    expect(a[0]).toHaveProperty("description");
    expect(a[0]).toHaveProperty("date");
  });

  it("returns changelog with entries", () => {
    const c = getChangelog();
    expect(c.length).toBeGreaterThan(0);
    expect(c[0].entries.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// F. Finance Enhancements (Items 86-105)
// ═══════════════════════════════════════════════════════════

describe("Finance Enhancements", () => {
  describe("calculateBundleDiscount", () => {
    it("calculates discounted price below total balance", () => {
      const result = calculateBundleDiscount([
        { balance: 10000, rate: 0.10, monthsRemaining: 60 },
        { balance: 15000, rate: 0.12, monthsRemaining: 48 },
      ]);
      expect(result.totalBalance).toBe(25000);
      expect(result.discountedPrice).toBeLessThan(25000);
      expect(result.discountedPrice).toBeGreaterThan(0);
      expect(result.yield).toBeGreaterThan(0);
    });

    it("handles single note", () => {
      const result = calculateBundleDiscount([{ balance: 5000, rate: 0.09, monthsRemaining: 36 }]);
      expect(result.totalBalance).toBe(5000);
      expect(result.discountedPrice).toBe(4000); // 80% of 5000
    });
  });
});
