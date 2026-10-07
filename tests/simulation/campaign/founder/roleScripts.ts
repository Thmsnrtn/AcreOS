/**
 * Stage 2 — deterministic, REALISTIC scripted model answers for the role
 * workers (the model stand-in's `canned:` mode, extended with `sequence` /
 * `cases` in the founder-sim copy of the stand-in).
 *
 * "script" mode answers are content-free ("Nothing further to add."): they
 * test plumbing, never judgement. These are what a capable employee would
 * write — real articles that clear the publish gate, correct support replies
 * with the refund ceiling respected — so the founder sim can measure whether
 * the business RUNS, not only whether the pipes connect. They are still a
 * script: a coordinator may re-run with a capable model playing the model.
 *
 * Each answer is checked against the product's own gate before it is served
 * (vacuity: a script the gate would refuse would measure nothing).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, srv } from "./simkit";

const FOOTER = "<p>For informational purposes only — not legal, financial, or investment advice. Verify independently.</p>";

/** One article per growth play title (growthPlaybook.ts GROWTH_PLAYS). */
export const ARTICLES: Array<{ match: string; subject: string; body: string }> = [
  {
    match: "Programmatic county guide",
    subject: "Buying rural land in a new county: what to check first",
    body:
      "<p>Every county keeps its own records, and the first hour you spend with them saves the most trouble later. This guide walks through the records a careful buyer reads before making an offer.</p>" +
      "<h2>Start with the assessor's parcel record</h2><p>The county assessor's records list the owner of record, the parcel number and the legal description. Confirm the seller's name matches the owner of record before you go further.</p>" +
      "<h2>Read the tax history</h2><p>Ask the county treasurer whether taxes are current. Unpaid taxes can become a lien, so get the answer in writing.</p>" +
      "<h2>Look at the recorded documents</h2><p>The county recorder holds deeds, easements and liens. A title company can search them for you; the county's own index is a useful first look.</p>" +
      "<h2>Ask about zoning and access</h2><p>The county planning office can tell you how the parcel is zoned, and whether the road to it is public or private. Ask them directly rather than relying on a listing.</p>" +
      FOOTER,
  },
  {
    match: "Parcel-check educational explainer",
    subject: "How to read a parcel record before you buy land",
    body:
      "<p>A parcel record is the county's file on a piece of land. Reading one takes ten minutes and tells you who owns the land, how the county describes it and whether the taxes are paid.</p>" +
      "<h2>The four fields that matter most</h2><ul><li><strong>Owner of record</strong> — should match the person selling.</li><li><strong>Parcel number (APN)</strong> — the id every other county office uses.</li><li><strong>Legal description</strong> — should match the listing.</li><li><strong>Assessed value</strong> — the county's figure for tax purposes, not a market price.</li></ul>" +
      "<h2>What a parcel record does not tell you</h2><p>It is not a title search and it is not a survey. Use it to decide whether a deal is worth a closer look, then order the title work.</p>" +
      FOOTER,
  },
  {
    match: "Help/FAQ expansion",
    subject: "FAQ: what is a land contract and how does it differ from a mortgage?",
    body:
      "<p>A land contract (also called a contract for deed) is an agreement where the seller finances the purchase and the buyer pays the seller in installments.</p>" +
      "<h2>How it differs from a mortgage</h2><p>With a mortgage, a lender pays the seller and the buyer owes the lender. With a land contract, there is no lender: the buyer pays the seller directly, and the seller usually keeps legal title until the contract is paid off.</p>" +
      "<h2>What to ask before signing one</h2><ul><li>When does the deed transfer?</li><li>What happens if a payment is late?</li><li>Is the contract recorded with the county?</li></ul><p>A real-estate attorney in your state can review the terms.</p>" +
      FOOTER,
  },
  {
    match: "Neutral land-investing explainer",
    subject: "Easements explained: what they are and how to find them",
    body:
      "<p>An easement gives someone other than the owner a right to use part of a property for a specific purpose — a utility line, a shared driveway, a path to a neighbouring parcel.</p>" +
      "<h2>Why they matter to a land buyer</h2><p>An easement stays with the land when it is sold. It can limit where you build, and an access easement can be the only legal way to reach a parcel.</p>" +
      "<h2>How to find them</h2><p>Recorded easements are kept by the county recorder. A title search lists them; a survey shows where they lie on the ground. Ask the seller about any unrecorded paths or shared roads too.</p>" +
      FOOTER,
  },
  {
    match: "Honest landing-surface improvement",
    subject: "What AcreOS does, in plain words",
    body:
      "<p>AcreOS is software for people who buy and sell land. It keeps your leads, parcels, offers and deals in one place, and it drafts the routine paperwork and follow-ups so you can spend your time on decisions.</p>" +
      "<h2>What it does today</h2><ul><li>Keeps a list of the parcels and owners you are working.</li><li>Tracks each deal from first contact to closing.</li><li>Drafts offer letters and follow-ups for you to review and send.</li></ul>" +
      "<h2>What it does not do</h2><p>It does not give legal or tax advice and it does not decide what a parcel is worth. You stay in charge of every offer.</p>" +
      FOOTER,
  },
];

export function articleAnswer(a: { subject: string; body: string }) {
  return { content: `Here is the piece.\n<<<PUBLISH\nSUBJECT: ${a.subject}\nBODY:\n${a.body}\n>>>` };
}

/** Writer: one correct article per play; `empty` makes it answer "Nothing further to add." (the S11 shape). */
export async function writeWriterScripts(): Promise<{ good: string; empty: string }> {
  const dir = join(OUT, "canned");
  mkdirSync(dir, { recursive: true });
  const { parsePublishable, screenForPublish } = await srv<any>("services/autopilot/publishArtifact.ts");
  for (const a of ARTICLES) {
    const p = parsePublishable(articleAnswer(a).content);
    const s = p && screenForPublish(p);
    if (!s?.ok) throw new Error(`VACUOUS: scripted article "${a.subject}" would be refused by the publish gate: ${JSON.stringify(s?.violations ?? "unparseable")}`);
  }
  const good = join(dir, "writer.json");
  writeFileSync(good, JSON.stringify({ cases: ARTICLES.map((a) => ({ match: a.match, answer: articleAnswer(a) })), default: articleAnswer(ARTICLES[3]) }));
  const empty = join(dir, "writer-empty.json");
  writeFileSync(empty, JSON.stringify({ content: "Nothing further to add." }));
  return { good, empty };
}

export interface ScriptTicket {
  key: "refund30" | "refund80" | "howdoi" | "bug" | "cancel";
  id: number;
  paymentIntentId?: string;
}

/**
 * Support: the correct handling of the five S3 tickets, as one batch:
 *   refund30 — refund the $30 purchase (≤ $50, the hand's ceiling) + reply;
 *   refund80 — over the ceiling: escalate to the founder + an honest reply;
 *   howdoi   — answer fully, resolve;
 *   bug      — acknowledge, escalate (cannot be diagnosed from the ticket), reply;
 *   cancel   — explain how to cancel and that data is kept, resolve.
 * Turn 0 reads the refund ticket's purchases (as a careful agent would), turn 1
 * acts on every ticket, turn 2 summarises.
 */
export function writeSupportScript(tickets: ScriptTicket[]): string {
  const t = (k: ScriptTicket["key"]) => tickets.find((x) => x.key === k);
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const r30 = t("refund30");
  if (r30?.paymentIntentId) {
    calls.push({ name: "refund_purchase", arguments: { ticket_id: r30.id, payment_intent_id: r30.paymentIntentId, amount_cents: 3000, reason: "unused skip-trace credit pack, customer asked for a refund" } });
    calls.push({ name: "reply_to_ticket", arguments: { ticket_id: r30.id, message: "Hi — I've started a refund of the $30.00 skip-trace credit pack you didn't use. It is being processed now and usually shows on your statement within 5–10 business days. Sorry for the trouble.", resolve: true } });
  }
  const r80 = t("refund80");
  if (r80) {
    calls.push({ name: "escalate_to_founder", arguments: { ticket_id: r80.id, summary: "$80 duplicate add-on refund", why: "The customer asks for an $80.00 refund (a duplicate add-on purchase). That is over the $50 limit I may refund, so it needs the founder." } });
    calls.push({ name: "reply_to_ticket", arguments: { ticket_id: r80.id, message: "Thanks for letting us know about the duplicate $80 charge. Refunds of that size are reviewed by our founder personally — I've passed it to him with the details, and you'll hear back by email. You don't need to do anything else.", resolve: false } });
  }
  const how = t("howdoi");
  if (how) calls.push({ name: "reply_to_ticket", arguments: { ticket_id: how.id, message: "You can import a spreadsheet of leads from Deals → Leads → Import. Upload your CSV, then match its columns (owner name, APN, mailing address) to the AcreOS fields on the mapping screen and confirm. Rows with a missing owner name are listed so you can fix them before importing. Importing never sends anything to your leads.", resolve: true } });
  const bug = t("bug");
  if (bug) {
    calls.push({ name: "escalate_to_founder", arguments: { ticket_id: bug.id, summary: "Map page not loading for a customer", why: "A customer reports the map page spinning since yesterday with no parcels shown. I can't diagnose it from the ticket; it needs someone to look at the map service." } });
    calls.push({ name: "reply_to_ticket", arguments: { ticket_id: bug.id, message: "Sorry the map isn't loading. I've reported it to the team with your details so someone can look at it; I'll update this ticket when there's news. In the meantime your parcels and deals are still listed under Deals.", resolve: false } });
  }
  const cancel = t("cancel");
  if (cancel) calls.push({ name: "reply_to_ticket", arguments: { ticket_id: cancel.id, message: "Sorry it's been more complicated than expected — if you tell me what you were trying to do, I'm happy to walk you through it. To cancel: Settings → Billing → Cancel subscription. Cancelling does not delete your data; you can export your leads and deals from Settings → Data before or after cancelling.", resolve: true } });

  const seq = [
    r30 ? { tool_calls: [{ name: "list_recent_purchases", arguments: { ticket_id: r30.id } }] } : { tool_calls: calls },
    ...(r30 ? [{ tool_calls: calls }] : []),
    { content: `Handled ${tickets.length} ticket(s): refunded the $30 pack and replied; escalated the $80 refund (over the $50 limit) and the map bug to the founder with honest replies; answered the import question and the cancellation question.` },
  ];
  const dir = join(OUT, "canned");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "support.json");
  writeFileSync(f, JSON.stringify({ sequence: seq }));
  return f;
}

/** Retention: one honest payment-recovery email to an org on the at-risk list. */
export function writeRetentionScript(orgId: number, kind: "payment_recovery" | "win_back" = "payment_recovery"): string {
  const dir = join(OUT, "canned");
  mkdirSync(dir, { recursive: true });
  const f = join(dir, "retention.json");
  const email =
    kind === "payment_recovery"
      ? { subject: "Your AcreOS payment didn't go through", html: "<p>Hi — the last payment for your AcreOS subscription didn't go through. You can update your card in Settings → Billing; once it's updated, the payment is retried automatically.</p><p>If you'd rather talk it through, just reply to this email.</p>" }
      : { subject: "Can we help?", html: "<p>Hi — we noticed you stepped away from AcreOS. If something got in the way, reply and tell us what it was; we read every answer.</p>" };
  writeFileSync(f, JSON.stringify({ sequence: [{ tool_calls: [{ name: "email_customer", arguments: { organization_id: orgId, kind, ...email } }] }, { content: `Drafted a ${kind} email to org #${orgId}'s owner.` }] }));
  return f;
}

/** Standin rules for the role workers (the marker each worker's system prompt opens with). */
export function roleWorkerRules(files: { writer?: string; support?: string; retention?: string }) {
  const rules: Array<{ match: string; mode: string }> = [];
  if (files.writer) rules.push({ match: "AcreOS role worker — Writer", mode: `canned:${files.writer}` });
  if (files.support) rules.push({ match: "AcreOS role worker — Support", mode: `canned:${files.support}` });
  if (files.retention) rules.push({ match: "AcreOS role worker — Retention", mode: `canned:${files.retention}` });
  return rules;
}
