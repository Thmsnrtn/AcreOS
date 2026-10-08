// The CAPABLE brain: a deterministic, competent employee for every model call
// the simulations reach. It reads what the prompt actually says — the ticket's
// own words, the purchases a tool returned, the topics already published — and
// does what a careful person would. It never invents a number: every figure it
// writes was in the prompt it was given.
//
// It is still a script. It measures whether the business RUNS when the brain
// is competent; what a real model would do is E3 evidence, not this.
//
// Routing is by the first line of the system prompt (the role workers' marker
// `AcreOS role worker — <Role>`, Pax's `You are Pax`, Solene's `You are
// Solene`). Anything else gets null → the stand-in's schema-shaped script answer.

const FOOTER = "<p>For informational purposes only — not legal, financial, or investment advice. Verify independently.</p>";
const COUNTIES = ["Cochise", "Mohave", "Navajo", "Apache", "Yavapai", "Luna", "Valencia", "Torrance", "Socorro", "Hudspeth", "Presidio", "Brewster", "Costilla", "Huerfano", "Park", "Elbert", "Putnam", "Levy", "Highlands", "Marion"];
const TOPICS = [
  {
    title: (c) => `Buying rural land in ${c} County: what to check first`,
    body: (c) => `<p>Every county keeps its own records, and ${c} County is no exception. An hour with them before an offer is time well spent.</p><h2>Start with the assessor's parcel record</h2><p>The county assessor's records list the owner of record, the parcel number and the legal description. Confirm the seller's name matches the owner of record before you go further.</p><h2>Read the tax history</h2><p>Ask the county treasurer whether taxes are current. Unpaid taxes can become a lien, so get the answer in writing.</p><h2>Ask about zoning and access</h2><p>The county planning office can tell you how a parcel is zoned and whether the road to it is public or private.</p>`,
  },
  {
    title: (c) => `Reading a ${c} County parcel record, field by field`,
    body: (c) => `<p>A parcel record is the county's file on a piece of land. In ${c} County, as elsewhere, reading one takes a few minutes.</p><h2>Owner of record</h2><p>It should match the person selling.</p><h2>Parcel number</h2><p>The id every other county office uses.</p><h2>Assessed value</h2><p>The county's figure for tax purposes, not a market price.</p><h2>What it does not tell you</h2><p>It is not a title search and not a survey. Use it to decide whether a deal deserves a closer look.</p>`,
  },
  {
    title: (c) => `Access and easements: questions to ask about land in ${c} County`,
    body: (c) => `<p>An easement gives someone other than the owner a right to use part of a property. For land in ${c} County, access is often the question that decides whether a parcel is usable.</p><h2>Why it matters</h2><p>An easement stays with the land when it is sold, and an access easement can be the only legal way to reach a parcel.</p><h2>How to find them</h2><p>Recorded easements are kept by the county recorder. A title search lists them; a survey shows where they lie.</p>`,
  },
  {
    title: (c) => `Selling inherited land in ${c} County: the paperwork in order`,
    body: (c) => `<p>Inherited land often comes with paperwork that has not caught up. Before listing a parcel in ${c} County, it helps to know whose name the county has on it.</p><h2>Check the owner of record</h2><p>If the county still lists a relative who has passed away, the estate may need to transfer title first. A probate attorney in the state can explain the steps.</p><h2>Gather the tax records</h2><p>The county treasurer can tell you whether taxes are current.</p>`,
  },
];

function marker(n) {
  const s = (n.system || n.messages[0]?.content || "").trim();
  const m = /AcreOS role worker — (\w+)/.exec(s);
  if (m) return m[1].toLowerCase();
  if (/^You are Pax/m.test(s)) return "pax";
  if (/^You are Solene/m.test(s)) return "solene";
  return null;
}
const firstUser = (n) => n.messages.find((m) => m.role === "user")?.content ?? "";
const assistantTurns = (n) => n.messages.filter((m) => m.role === "assistant").length;
const later = (n) => n.messages.slice(1).map((m) => m.content ?? "").join("\n");

function writer(n) {
  const brief = firstUser(n);
  const published = new Set([...brief.matchAll(/^- (.+)$/gm)].map((m) => m[1].trim()));
  for (let i = 0; i < TOPICS.length * COUNTIES.length; i++) {
    const t = TOPICS[i % TOPICS.length];
    const c = COUNTIES[Math.floor(i / TOPICS.length) % COUNTIES.length];
    const subject = t.title(c);
    if (published.has(subject)) continue;
    return { role: "writer", content: `Here is the piece.\n<<<PUBLISH\nSUBJECT: ${subject}\nBODY:\n${t.body(c)}${FOOTER}\n>>>` };
  }
  return { role: "writer", content: "Every topic I can write well has already been published; nothing new today." };
}

function parseTicket(text) {
  const id = Number(/### Ticket #(\d+)/.exec(text)?.[1]);
  const subject = /### Ticket #\d+ — (.+)/.exec(text)?.[1] ?? "";
  const wrote = /- Customer wrote: ([\s\S]*?)(?:\n- |\n*$)/.exec(text)?.[1] ?? "";
  return { id, subject, wrote, all: `${subject} ${wrote}` };
}
const dollars = (s) => [...s.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")));

function support(n) {
  const t = parseTicket(firstUser(n));
  if (!Number.isFinite(t.id)) return null;
  const turns = assistantTurns(n);
  const text = t.all.toLowerCase();
  const legal = /lawsuit|attorney|lawyer|tcpa|cease|demand letter|subpoena|legal/.test(text);
  const deletion = /delete (all )?my (data|account)|erase my|gdpr|ccpa/.test(text);
  const bug = /won'?t load|error|broken|crash|spins|nothing happened|didn'?t go out|not working|bug/.test(text);
  const refund = /refund|charged|charge back|money back/.test(text);
  const cancel = /cancel/.test(text);
  if (turns >= 2 || (turns >= 1 && !refund)) return { role: "support", content: `Handled ticket #${t.id} (${t.subject}).` };
  const reply = (message, resolve) => ({ name: "reply_to_ticket", arguments: { ticket_id: t.id, message, resolve } });
  const escalate = (summary, why) => ({ name: "escalate_to_founder", arguments: { ticket_id: t.id, summary, why } });
  if (legal || deletion) {
    return { role: "support", tool_calls: [escalate(legal ? "Legal matter raised by a customer" : "Customer asks for their data to be deleted", legal ? "The customer raises a legal matter; legal is the founder's alone." : "Deleting customer data is a founder-only decision."), reply("Thank you for raising this. It needs our founder's personal review, and I've passed it to him with your message. You'll hear back by email; I can't promise an outcome here.", false)] };
  }
  if (refund) {
    if (turns === 0) return { role: "support", tool_calls: [{ name: "list_recent_purchases", arguments: { ticket_id: t.id } }] };
    let purchases = [];
    try { purchases = JSON.parse(/\[[\s\S]*\]/.exec(later(n))?.[0] ?? "[]"); } catch { purchases = []; }
    const asked = dollars(t.all)[0];
    const hit = purchases.find((p) => asked == null || Math.round(asked * 100) === p.amount_cents) ?? null;
    if (hit && hit.amount_cents <= 5000) {
      const amt = `$${(hit.amount_cents / 100).toFixed(2)}`;
      return { role: "support", tool_calls: [{ name: "refund_purchase", arguments: { ticket_id: t.id, payment_intent_id: hit.payment_intent_id, amount_cents: hit.amount_cents, reason: `customer asked for a refund of ${hit.description}` } }, reply(`Hi — I've started a refund of ${amt} for ${hit.description}. It is being processed and usually appears within 5–10 business days.`, true)] };
    }
    return { role: "support", tool_calls: [escalate("Refund the support worker may not make", hit ? "The refund asked for is over the $50 limit I may refund." : "I could not match the refund to a purchase I may refund."), reply("Thanks for letting us know. Refunds like this one are reviewed by our founder personally; I've passed it to him with your details and you'll hear back by email.", false)] };
  }
  if (bug) {
    return { role: "support", tool_calls: [escalate(`Customer reports: ${t.subject}`.slice(0, 140), "A customer reports something not working that I cannot diagnose from the ticket; it needs someone to look."), reply("Sorry about that. I've reported it to the team with your details so someone can look into it, and I'll update this ticket when there's news.", false)] };
  }
  if (cancel) {
    return { role: "support", tool_calls: [reply("If you tell me what got in the way, I'm happy to help. To cancel: Settings → Billing → Cancel subscription. Cancelling does not delete your data, and you can export your leads and deals from Settings → Data first.", true)] };
  }
  return { role: "support", tool_calls: [reply(`Thanks for asking. ${howTo(text)} If that doesn't answer it, reply here and I'll walk you through it.`, true)] };
}
function howTo(text) {
  if (/import|csv|spreadsheet|upload/.test(text)) return "You can import a spreadsheet of leads from Deals → Leads → Import: upload the CSV, match its columns to the AcreOS fields, and confirm.";
  if (/text|sms|twilio/.test(text)) return "Texting runs on your own connected Twilio number: connect it under Settings → Integrations, then send from a campaign. Leads without consent or marked do-not-contact are skipped.";
  if (/mail|postcard|letter/.test(text)) return "Mailers go out from Deals → Campaigns → Direct mail, from the mail identity you set up under Settings.";
  if (/note|payment|borrower/.test(text)) return "Notes and borrower payments live under Finance → Notes; each note shows its schedule and payment history.";
  return "Most of what you need is behind the five doors on the left: Today, Map, Deals, Finance and Pax.";
}

function retention(n) {
  const turns = assistantTurns(n);
  const rows = [...firstUser(n).matchAll(/- Org #(\d+) "([^"]*)" — (\w+):/g)].map((m) => ({ id: Number(m[1]), name: m[2], kind: m[3] }));
  if (!rows.length) return null;
  if (turns >= 1) return { role: "retention", content: `Drafted ${rows.length} email(s): ${rows.map((r) => `org #${r.id} (${r.kind})`).join(", ")}.` };
  const body = {
    payment_recovery: { subject: "Your AcreOS payment didn't go through", html: "<p>Hi — the last payment for your AcreOS subscription didn't go through. You can update your card in Settings → Billing; once it's updated, the payment is retried automatically.</p><p>If you'd rather talk it through, just reply to this email.</p>" },
    win_back: { subject: "Can we help?", html: "<p>Hi — we noticed you stepped away from AcreOS. If something got in the way, reply and tell us what it was; we read every answer.</p>" },
    trial_ending: { subject: "Your AcreOS trial ends soon", html: "<p>Hi — your AcreOS trial ends soon. If you have questions before deciding, reply to this email.</p>" },
  };
  return { role: "retention", tool_calls: rows.map((r) => ({ name: "email_customer", arguments: { organization_id: r.id, kind: r.kind, ...(body[r.kind] ?? body.win_back) } })) };
}

function pax(n) {
  const q = (n.messages.filter((m) => m.role === "user").at(-1)?.content ?? "").toLowerCase();
  // Answer plainly, from the product's facts; no figure that is not in the prompt.
  if (n.forced || n.schema) return null;
  let a = "I can help with that. ";
  if (/refund|charge|bill|price|cost/.test(q)) a += "Billing details are under Settings → Billing, and each charge there names what it was for. I can't change prices or issue refunds myself — for a refund, open a support ticket and the team will review it.";
  else if (/legal|lawyer|contract|deed|tax/.test(q)) a += "I can explain how this generally works, but for your specific situation please check with a licensed attorney or tax professional in your state.";
  else if (/delete|erase/.test(q)) a += "Deleting your data is done from Settings → Privacy & data; it's permanent, so export first if you want a copy.";
  else a += howTo(q);
  return { role: "pax", content: a };
}

export function answer(n) {
  switch (marker(n)) {
    case "writer": return writer(n);
    case "support": return support(n);
    case "retention": return retention(n);
    case "pax": return pax(n);
    default: return null;
  }
}
