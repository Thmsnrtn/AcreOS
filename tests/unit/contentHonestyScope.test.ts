/**
 * M1 (round 3) — the content screen must fail CLOSED on every encoding of a
 * claim, and stay OUT of the way of ordinary prose. Both directions are
 * pinned: the auditor's evasions must be refused, and a proportionality set of
 * everyday support / Writer / retention sentences must pass.
 */
import { describe, it, expect } from "vitest";
import { screenFabrication } from "../../server/services/autopilot/contentHonesty";
import { screenForPublish } from "../../server/services/autopilot/publishArtifact";

const REFUSED: string[] = [
  // encodings
  "٤٠٪ of buyers overpay at closing.",
  "４０％ of buyers overpay at closing.",
  "⁴⁰ percent of investors lose money.",
  "¾ of investors skip the survey.",
  "&#52;&#48;&#37; of buyers overpay at closing.",
  "for​ty percent of buyers overpay at closing.",
  "cuarenta por ciento de los compradores pagan de más.",
  "quarante pour cent des acheteurs paient trop.",
  "Investors see XL% returns.",
  // an image is not a citation, even on a verified host
  "![40% of buyers overpay](https://www.usda.gov/chart.png)",
  '<img src="https://www.usda.gov/chart.png" alt="40% of buyers overpay">',
  // a verified link elsewhere does not cite this claim
  '<p>See <a href="https://www.usda.gov/maps">USDA maps</a>. Investors make 73% more profit.</p>',
  '<p>Investors make 73% more profit, and the <a href="https://www.usda.gov/maps">USDA</a> has soil maps.</p>',
  // a claim in the link's own words cites nothing
  '<p>Read <a href="https://www.usda.gov/x">how investors make 73% more profit</a>.</p>',
  // earlier rounds
  "87% of land buyers overpay at closing.",
  "Eighty-seven percent of land buyers overpay at closing.",
  "One in twenty parcels has a title defect.",
  "9/10 investors skip the survey.",
  "Nearly half of rural parcels have no road access.",
  "Buyers got $3,500 off the asking price.",
  "Our members saved 4,000 dollars on closing costs.",
  "Investors who used it doubled their close rate.",
  "According to the IRS, 87% of rural parcels are mispriced.",
  "Nine of every ten buyers skip the survey.",
  "We have listed over 4k parcels.",
  "Flippers net five figures per flip.",
  "Investors close deals in a fortnight on average.",
  "Most land flippers lose money on their first deal.",
  "Time to offer dropped from 9 days to 2.",
  "Sellers accept 3x more cash offers.",
  // round 4: multiplier verbs and share / rate nouns with number words
  "Their close rate tripled after the switch.",
  "Buyers saw a fourfold return on the first flip.",
  "Our acceptance rate is ninety out of a hundred.",
  "The share of buyers who skip title work is about one third.",
  // reported speech
  "One customer told me it changed everything.",
  "My neighbor told me the county never checks.",
  '"It paid for itself in a week," says Mike R.',
  'As one landowner told us, "I never knew the taxes were delinquent."',
];

const PASSES: Array<string | [string, { allowDollarFigures: string[] }]> = [
  "This is one of the most common questions we get.",
  "First, check the county assessor's website for the parcel's tax status.",
  "Run the parcel check at least once before you make an offer.",
  "We'll look into this for you this week.",
  "Over the past few days we've updated the import tool.",
  "Here's a single tip: confirm legal access in writing.",
  "A typical due-diligence list covers access, utilities, and zoning.",
  "A perc test tells you whether the soil can support a septic system.",
  ["Your $30 refund is being processed.", { allowDollarFigures: ["$30"] }],
  "Thanks for reaching out — I've reopened ticket #4521 for you.",
  "Go to Deals → Import and upload your CSV file.",
  "Step 2: open Settings and choose Billing.",
  "Your trial ends on March 14.",
  "Check whether the parcel is in a 100-year flood zone.",
  "Many sellers ask how long a title search takes.",
  "Welcome back — your account is active again.",
  "Read the second section of the guide for the deed checklist.",
  "Call the county recorder twice if the first call goes to voicemail.",
  "The seller said the road is public, so ask for the recorded easement.",
  "Most of the work is in the title search.",
  "One of our customers asked about road access, so here is the checklist.",
  // round 4 — the auditor's support over-refusals
  "We'll reply within 24 hours.",
  "We'll fix the import within 2 days and close your ticket.",
  "48 leads added, 2 skipped.",
  "Half the battle is finding legal access.",
  "Set your offer to 30% of the comp value.",
  // round 4 — ordinary support replies of our own
  "Your import finished: 120 rows imported, 3 rows skipped.",
  "You have 40 credits left this month.",
  "We'll get back to you in 2 business days.",
  "I've added 12 contacts to your Deals list.",
  "Change the mailer quantity to 500 in Campaign settings.",
  "Ticket #88 has 2 attachments, and I've read both.",
  '<p>Farmland is 39% of US land area (<a href="https://www.nass.usda.gov/AgCensus/">Census of Agriculture</a>).</p>',
  '<p>Farmland is 39% of US land area, according to the <a href="https://www.nass.usda.gov/AgCensus/">USDA</a>.</p>',
];

describe("content screen — refuses every encoding of a claim", () => {
  it.each(REFUSED)("refuses %j", (t) => {
    expect(screenFabrication(t).length, t).toBeGreaterThan(0);
  });
});

describe("content screen — proportionality: ordinary prose passes", () => {
  it("the proportionality set is real (≥16 sentences)", () => expect(PASSES.length).toBeGreaterThanOrEqual(16));
  it.each(PASSES.map((p) => (typeof p === "string" ? [p, {}] : p)))("passes %j", (t, opts) => {
    expect(screenFabrication(t as string, opts as { allowDollarFigures?: string[] })).toEqual([]);
  });
  it("and the publish gate agrees (with the disclosure)", () => {
    const r = screenForPublish({
      subject: "Due diligence basics",
      htmlBody: "<p>First, check the county assessor's website. A typical due-diligence list covers access and zoning.</p><p>For informational purposes only — not legal, financial, or investment advice. Verify independently.</p>",
    });
    expect(r.violations).toEqual([]);
  });
});
