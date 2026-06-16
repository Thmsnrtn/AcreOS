# Founder Autopilot — The North Star (System + Interface, elevated)

**Date:** 2026-06-16
**Brief (Tom):** Take everything and architect it to the highest level — beyond the conversation — including the daily UI. The most gorgeous, intuitive, effortless founder interface possible.

This is the vision the build (`founder-autopilot-2026-06-16.md`) walks toward. It reframes *what* we're building and *what it feels like to live with.*

---

## The reframe: from "a dashboard that runs tasks" to "a living company that answers to its sovereign"

The ceiling of most "AI runs your business" products (Polsia included) is a control panel for a bot that does chores. The ceiling we're aiming for is different in kind:

**AcreOS becomes a self-governing organism with a single human it answers to — you — and it writes to you each morning.** You don't *operate* it. You *preside* over it. It has intent, senses, judgment, hands, memory, an immune system, a conscience, and a voice. Your job is to set its direction and its values, approve the rare sovereign-level decision, and otherwise let it live. The interface is not a console — it's the daily correspondence from your company to you.

---

## Part I — The elevated architecture (the organism)

The four pillars from the build plan are the anatomy. Elevated, they cohere into a living system:

| Organ | What it is | Status |
|---|---|---|
| **Genome (intent)** | The constitution + a tiny set of founder *intents* (north-star goals). Everything the system does is derived, teleologically, from these. | Constitution exists; **intent layer is new** |
| **Senses** | Real telemetry — MRR, churn, funnel, runway, cost, support, alignment drift. | Partly stubbed (`DEFAULT_` constants); un-stubbing is P0 batch 4 |
| **Nervous system** | The event bus + detectors that turn signals into reflexes. | Exists (detectors, auto-dispatch) |
| **Brain (governed CEO)** | The operating loop — elevated to **intent-driven OKR self-management**. | Loop shell exists; decide-body is new |
| **Hands** | The dispatch consumer + the growth/support engines that act in the world. | Consumer wired (batch 1, dormant) |
| **Immune system** | The policy-gate stack + alignment audit + circuit breakers + kill-switch. | Gate stack built (batch 2); rest exists |
| **Memory** | Procedural (learned playbooks) + semantic (vectors) + the cross-org data-coop (collective intelligence). | Exists; learning loop is new |
| **Metabolism** | The cost/budget economics — feeds on AI tokens, earns revenue, reinvests, grows its own budget. | Cost ceiling exists; auto-ramp is new |
| **Conscience** | Constitution + truth-ratchet + honest-null grounding — it structurally cannot lie or act against its values. | Exists |
| **Voice** | The narration engine — it tells you its story in plain, beautiful language. | **New (the heart of the UI)** |

### Six elevations beyond the conversation

1. **Intent-driven, self-managed OKRs.** You declare 2–3 *intents* in plain language ("reach $1k MRR sustainably," "land investors evangelize it," "stay lean + legal"). The brain writes its own objectives + key results under each and works them autonomously, reporting progress like a CEO to a board of one. You set the *why*; it owns the *how*.

2. **The Trust Ledger.** Earned autonomy made visible and emotional. Every domain carries an accruing trust score; you *watch* it rise with clean outcomes and autonomy expand. The felt experience of your company growing up.

3. **Simulate-before-act.** For uncertain or high-stakes moves, the system dry-runs the outcome (the scenario war room already exists) and attaches a counterfactual — "if I send this: ~X signups, $Y cost, Z% risk" — before acting or escalating. Less risk, less founder load, more intelligence.

4. **The Narrative Engine.** The system continuously composes an editorial, plain-language story of what it did, why, and what's next. This is the 0.01% experience: you read a paragraph, not a console.

5. **Reversibility-by-default.** Every autonomous action is logged with a reversal path. You can undo anything from the UI. Control as a feeling, not just a setting.

6. **The Sovereign's Standing Orders.** Beyond approvals — you issue durable natural-language policy ("never email anyone twice in a week," "prioritize Texas tax-delinquent investors") that the system honors forever. You shape the company by speaking to it.

---

## Part II — The daily interface (the most gorgeous, effortless surface)

**Philosophy: a daily letter from your company, not a dashboard.** Calm, editorial, alive. Opening it should feel like receiving a beautifully typeset briefing from a brilliant chief of staff — and, most days, learning you have nothing to do. The emotional target is **calm, confidence, and a little awe.**

**Design language:** the existing Tahoe / Bedrock identity — Fraunces editorial display, Inter body, liquid-glass depth, the warm Bedrock palette, generous whitespace, calm `staggerContainer`/`staggerItem` motion, full mobile + desktop parity. Not a SaaS admin panel. A living document.

### The single surface, top to bottom

1. **The Word (the hero — not KPIs).** A warm Fraunces greeting + a one-paragraph morning narrative in Solene's voice: what happened overnight, what's in motion, and the load-bearing line — *whether you're needed.*
   > *"Good morning, Tom. Everything's handled. Overnight I shipped an onboarding fix, published 2 county guides, and started 14 conversations with Texas land investors — 2 replied. Nothing needs you today."*
   On a day you're needed, one sentence changes: *"…one thing needs your call — below."*

2. **The Decision (only if one exists) — the hero card.** When a sovereign decision is required: ONE gorgeous card with the question, the system's recommendation + reasoning, the **simulated consequence of each choice**, and a single confident action (Approve · Decline · Tell me more). Witnessed-send, made beautiful. Most days it's absent — and its absence is the reward.

3. **The Vital Sign (one living visualization).** Not twelve cards. ONE organic, glanceable portrait of the few things that matter — the revenue heartbeat, the growth-trajectory arc, runway, and overall health as a calm color-field. Read it in one glance; tap to expand into depth only if you want it.

4. **The Trust Ledger (the felt sense of earning).** A quiet, beautiful strip: each domain climbing its autonomy ladder. *"Support — trusted to act on its own. Growth — earning trust (8/10 clean cycles). Deploys — supervised."* You watch your company become more capable. Emotionally, this is the core.

5. **The Story (the timeline, below the fold).** The narrative of what the system did — each entry a calm, readable editorial line that expands into full reasoning + the reversal path. The proof it works while you sleep, and a pleasure to read rather than a log to audit.

6. **Your Voice (standing orders + intents).** An elegant, conversational way to set an intent or issue a standing order in natural language — and watch it become durable policy. You shape the company by talking to it.

### The signature moment: the "nothing needed" state
Most products treat empty as failure. Here it is the entire point. When all-green, the screen is at its most beautiful — serene, almost meditative — confirming you're free.
> *"Everything's handled. Go build your life."*
The 0.01%-attention promise, made visible and emotional.

### The hierarchy of attention (designed for 0.01%)
- **Glance (2s):** the greeting line tells you if you're needed. If not — close it.
- **Read (30s):** the morning narrative + the vital sign.
- **Decide (rare):** the one hero decision card.
- **Explore (optional):** the story timeline + depth.
- **Shape (occasional):** set an intent / issue a standing order.

---

## How it coheres
The architecture and the interface are one idea: **a living, self-governing company that is driven by your intent, governed by your constitution, earns its own autonomy, acts within hard gates, narrates itself to you in plain language, and needs you almost never.** Every technical primitive already exists or is in P0; the elevations (intent layer, trust ledger, simulate-before-act, narrative engine, reversibility, standing orders) and the interface are what turn a governed automation into something that feels alive — and makes presiding over it the most calm, confident, and beautiful part of your day.

**Build relationship:** P0 (the build plan) makes it *work and safe*. This north-star defines what it *becomes* and *feels like* — the narration engine + the daily surface are the first elevations to build once the loop is live, because they're what you actually experience.
