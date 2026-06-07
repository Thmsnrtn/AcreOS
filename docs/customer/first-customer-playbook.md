# First-Customer Playbook

**Owner:** Rafe (CCO) · **Phase:** 0 (pre- and at first paying customers) · **Last updated:** 2026-06-06

At 1–5 paying customers, a 20-minute personal welcome is the highest-ROI retention
act we have, and it costs nothing but time. This playbook is the human layer that
sits on top of the product's automated activation. The single goal of week one is
to get the customer to the **parcel-data aha** — opening a real parcel and watching
soils, flood, wetlands, and elevation light up from free public data — because a
customer who experiences that becomes an evangelist, and one who never does churns
thinking we're "just another CRM."

> The product now leads the land/hybrid getting-started checklist with
> **"Look up your first property"** (→ Map door) ahead of add-lead/send-mailer, and
> the Map door's empty state has a **"See a sample"** button that runs a real
> free-data lookup on a curated, data-rich parcel. Use both as anchors in the calls
> below — never demo on a thin county.

---

## 1. Within 24 hours of first payment — the welcome

**Channel:** personal email from a real human (not a no-reply), optionally SMS if
they opted in.

**Goal:** make them feel personally cared for and book the first call.

Template beats (keep it short, no marketing tone):

- Thank them by name; reference what they told us they invest in (land / notes / both).
- One concrete promise: "On our first call I'll pull up a parcel *you* care about and
  we'll look at its soils, flood zone, and elevation together — all from free public
  records."
- One link: book a 20-minute call (their timezone).
- Sign with a real name and a direct reply path.

**SLA:** first welcome out within 24h of the first successful payment. No exceptions.

---

## 2. The first call — "let's pull up YOUR parcel"

**Length:** 20 minutes. **Anchor:** the data aha, on a parcel *they* name.

1. **Ask for one parcel they're actually looking at** (an address or APN, or a county
   they're farming). This makes the demo theirs, not ours.
2. **Open it on the Map door** and walk the overlays out loud: flood zone (FEMA NFHL),
   soil type + suitability (USDA SSURGO), wetlands (USFWS NWI), elevation/terrain
   (USGS 3DEP). Name the source as you go — naming the source is what makes free data
   feel authoritative.
3. **If their parcel's county is thin**, don't apologize and stall — switch to a
   curated sample parcel ("See a sample") so they still see the full wow-moment, then
   be honest: "Some counties publish thin public data; here's what a data-rich one
   looks like, and here's what a paid data add-on would fill later."
4. **Frame completeness honestly.** A 40% completeness score is "here's what county
   open data gives you for free," not "broken." Never present a gap as a failure.
5. **Tie it back to their workflow** — add that parcel as a lead/property so the data
   they just saw is now living in their pipeline.

**File for Maren:** verbatim quotes on (a) why they signed up and (b) the moment they
said "oh, nice" — that's the activation moment we double down on.

---

## 3. Day-3 checkpoint — friction check

**Channel:** short personal email.

- "Did you get a chance to look up a few of your own parcels?"
- One open question: "Anything confusing or missing so far?"
- Watch for: signs they never reached the data aha (didn't open the Map door / no
  enrichment lookup recorded). If so, re-offer a 5-minute screen-share.

**Internal signal:** the getting-started checklist's "Look up your first property" step
should be complete by now (`hasPropertyLookup`). If it isn't, that's the retention risk
to act on today.

---

## 4. Day-14 checkpoint — value + expansion

**Channel:** personal email or call.

- "What's one thing AcreOS has saved you time on in the last two weeks?"
- Surface a feature they haven't touched that fits their stated workflow.
- If they're a promoter (loves it), ask for the referral *now* — a land investor who
  sees a free soil map will tell their mastermind group.
- If they're lukewarm, treat it as a save opportunity: book a call, don't email.

---

## 5. The 5 exit-interview questions

Use these whenever a customer signals churn intent (cancel flow, detractor NPS, or
quiet disengagement). The cancellation flow already persists a structured reason plus
a free-text field; these questions go deeper on a save call. Capture verbatim and file
for Maren.

1. **What did you sign up to do?** (the original job-to-be-done)
2. **Did AcreOS do that? Where did it fall short?**
3. **What would have made you stay?** (this is the gold — also captured as free text in
   the cancellation dialog)
4. **What are you switching to, and what does it do that we don't?**
5. **Would you come back if we fixed [their #1 gap]? What would that take?**

---

## SLA summary (the promises we keep)

| Moment | SLA |
|---|---|
| Welcome after first payment | < 24h |
| First call booked | within first 48h |
| Onboarding to first value (data aha) | < 7 days |
| First support response | < 15 min (see `pax-handoff-rafe.md`) |
| Detractor NPS → personal touch | same day |

---

## Where the product helps (so the human layer scales)

- **Activation order:** land/hybrid getting-started checklist leads with the data aha
  (`client/src/components/getting-started-checklist.tsx`).
- **Never-empty first lookup:** "See a sample" curated parcels
  (`shared/curated-sample-parcels.ts`, `client/src/components/maps/SampleParcelPreview.tsx`).
- **Support reaches a human in real time:** ticket-created and Pax-escalation founder
  notifications (`server/services/supportNotifications.ts`).
- **Honest leave-door:** cancellation reasons + free-text feedback persist
  (`cancellation_surveys`) and are founder-readable at `/founder/customers/cancellation-reasons`.
