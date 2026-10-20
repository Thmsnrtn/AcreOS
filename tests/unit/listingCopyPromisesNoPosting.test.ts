/**
 * Founder decision 2026-10-20 #3: customers bring their own listing accounts.
 *
 * Listing syndication posts only on the customer's OWN channel account, and
 * `channelCredentialStore.resolve` answers null for every org and channel
 * until a connect flow exists — so no API channel can post. While that holds,
 * no customer surface may PROMISE automatic posting. The independent audit
 * (2026-10-20) found three that did after the backend went honest:
 *   - listings.tsx empty state: "Pax syndicates it to your active channels
 *     within 90 seconds and threads every inquiry back to the parcel";
 *   - tools.tsx: "Publish properties to Land.com, LandWatch, LandFlip, and more.";
 *   - nav-items.ts: "Publish listings to Land.com, LandWatch, etc.";
 * plus the pages behind them ("Live API", "push your listings everywhere at
 * once", "Portals like Zillow and Realtor.com sync automatically once
 * connected", "Each platform requires partner credentials configured in
 * Settings → Integrations" — there is no such setting).
 *
 * The CONDITION is read, not assumed: the test asks the real credential store
 * about every customer-account channel. When a connect flow lands and
 * `resolve` can answer, the promise gate stops applying (and this file should
 * be rewritten to the per-org truth).
 *
 * The SCAN is a parse (TypeScript, TSX-aware) over every string literal,
 * template chunk and JSX text node in client/src — never a comment, so the
 * record of what was removed is not read as the defect. Population: every
 * non-test .ts/.tsx under client/src, with a file floor and a per-member
 * vacuity check on the surfaces that render listing copy. Canaries: each
 * removed sentence must match a PROMISE pattern, and each honest sentence
 * now shipped must not.
 *
 * Mutation recorded: restoring the listings.tsx empty-state subtitle → red
 * (listings.tsx named in the offender list); restoring the tools.tsx desc →
 * red. Reverted after each red run.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PLATFORMS, channelCredentialStore, type LegacySyndicationPlatform } from "../../server/services/listingSyndication";

const ROOT = path.resolve(__dirname, "../..");
const CLIENT = path.join(ROOT, "client/src");

const CHANNEL = String.raw`(?:Land\.com|LandWatch|LandFlip|LandSearch|Lands of America|Facebook(?: Marketplace)?|Zillow|Realtor\.com|Craigslist|MLS|portals?|marketplaces?|(?:your )?(?:active )?channels?|platforms?|everywhere)`;

/** Sentences that say AcreOS / Pax will put a listing on a channel. */
const PROMISE: RegExp[] = [
  /\bsyndicat(?:e|es|ed|ing)\b(?!\s+(?:status|channels?|platforms?|results?))/i,
  // Verb forms only: "Posting to Land.com runs on your own account" is a
  // gerund SUBJECT describing where posting happens, not a promise to post.
  new RegExp(String.raw`\b(?:publish|post|push|send)(?:es|s|ed)?\b(?:\s+(?:it|them|your|land|my|the|this|every|listings?|properties|property))*\s+(?:to|on)\s+${CHANNEL}`, "i"),
  /\bsync(?:s|ed)? automatically\b/i,
  /\bLive API\b/,
  /\bpush your listings\b/i,
  /\bpartner credentials configured\b/i,
];

const promises = (text: string) => PROMISE.some((re) => re.test(text));

/**
 * Exact strings (whole-text equality, never a substring) that match a
 * PROMISE pattern without promising anything AcreOS does. Each must still
 * exist where it is registered, or the entry is stale and fails.
 */
const NOT_A_PROMISE: Array<{ file: string; text: string; why: string }> = [
  {
    file: "client/src/lib/upl-gating.ts",
    text: "DBPR has issued cease-and-desist orders to wholesalers who post properties on Zillow/Craigslist before closing. Marketing language must disclose 'equitable interest only — assignment of contract.'",
    why: "a legal warning describing what wholesalers do, not a capability",
  },
];

function listClientSources(dir = CLIENT): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      out.push(...listClientSources(p));
    } else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out.sort();
}

/** Every user-visible-capable text node: string literals, template chunks, JSX text. */
function textsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) {
      const t = n.text.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

async function anyChannelCanPost(): Promise<boolean> {
  for (const [id, cfg] of Object.entries(PLATFORMS)) {
    if (cfg.connection !== "customer_account") continue;
    for (const org of [1, 7, 4242]) {
      if ((await channelCredentialStore.resolve(org, id as LegacySyndicationPlatform)) !== null) return true;
    }
  }
  return false;
}

const LISTING_SURFACES = [
  "client/src/pages/listings.tsx",
  "client/src/pages/syndication.tsx",
  "client/src/pages/listing-syndication.tsx",
  "client/src/pages/tools.tsx",
  "client/src/lib/nav-items.ts",
];

describe("canaries: the PROMISE patterns catch what the audit found, and pass what ships now", () => {
  const REMOVED = [
    "Publish your first listing — Pax syndicates it to your active channels within 90 seconds and threads every inquiry back to the parcel.",
    "Publish properties to Land.com, LandWatch, LandFlip, and more.",
    "Publish listings to Land.com, LandWatch, etc.",
    "Publish land listings to Land.com, LandWatch, LandFlip, and more.",
    "Publish listings to MLS, portals, and marketplaces from one place.",
    "Connect MLS feeds, listing portals, or marketplaces to push your listings everywhere at once.",
    "Portals like Zillow and Realtor.com sync automatically once connected.",
    "Live API",
    "Syndicated to 2/3 platforms",
    "Select platforms to syndicate your listing to.",
    "Each platform requires partner credentials configured in",
  ];
  it.each(REMOVED)("catches %j", (s) => expect(promises(s)).toBe(true));

  const HONEST = [
    "AcreOS prepares the listing copy. Posting to Land.com or Facebook runs on your own account with each, which can't be connected yet; Craigslist gets ready-to-paste text.",
    "Listing copy per channel — posting runs on your own channel accounts, which can't be connected yet; Craigslist gets ready-to-paste text",
    "Choose channels. Craigslist returns ready-to-paste text; every other channel posts only on your own account with it, which AcreOS can't connect yet.",
    "Listing syndication",
    "Syndication platforms",
    "Couldn't load syndication channels",
  ];
  it.each(HONEST)("passes %j", (s) => expect(promises(s)).toBe(false));
});

describe("no client surface promises automatic listing posting while no channel account can be connected", () => {
  const files = listClientSources();

  it("the condition is read from the real credential store: no customer-account channel resolves", async () => {
    expect(Object.values(PLATFORMS).filter((c) => c.connection === "customer_account").length).toBeGreaterThanOrEqual(4);
    expect(await anyChannelCanPost()).toBe(false);
  });

  it("reads the whole client tree (floor), and every listing surface yields text (vacuity per member)", () => {
    expect(files.length).toBeGreaterThan(400);
    for (const rel of LISTING_SURFACES) {
      const abs = path.join(ROOT, rel);
      expect(files, `${rel} is outside the scanned population`).toContain(abs);
      expect(textsOf(abs).length, `${rel}: the parser found no text — it is not reading this file`).toBeGreaterThan(3);
    }
  });

  it("no string literal, template chunk or JSX text promises posting", async () => {
    if (await anyChannelCanPost()) return; // a connect flow exists — the per-org truth governs instead
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f).split(path.sep).join("/");
      for (const t of textsOf(f)) {
        if (NOT_A_PROMISE.some((x) => x.file === rel && x.text === t)) continue;
        // A route / key chunk (`/api/listings/${id}/syndicate`) is not prose.
        if (/^[\w./:#?=&-]*$/.test(t)) continue;
        if (promises(t)) offenders.push(`${path.relative(ROOT, f)}: ${JSON.stringify(t.slice(0, 140))}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every NOT_A_PROMISE entry still exists verbatim and still matches a pattern (no stale exemption)", () => {
    for (const x of NOT_A_PROMISE) {
      const texts = textsOf(path.join(ROOT, x.file));
      expect(texts, `${x.file}: exempted text is gone — delete the entry`).toContain(x.text);
      expect(promises(x.text), `${x.file}: exempted text no longer matches — delete the entry`).toBe(true);
    }
  });
});
