# R2-006: Tech-Savvy Pebble User / AI Feature Seeker

**Persona**: 29, product manager at a tech company. Does land investing on the side (6 deals closed). Uses Pebble for market tracking, ChatGPT for deal analysis, Notion for CRM. Specifically looking for AI-native RE tools.
**Device**: MacBook Air M3, Arc browser
**Referral**: Found via Product Hunt comment thread about AI in real estate.

---

## 1. CATEGORY (60 seconds)

**Score: 5 / 5**

> "'The AI-Powered Platform for Land Investors.' AI-powered is the keyword I was looking for. Most land tools are just databases with a UI. If this actually has AI built in, that's different."

> "The 'A' logo with the gradient -- clean. Minimal. Not the usual tacky RE software branding. This looks like it was built by people who care about design."

This visitor evaluates products like a PM. They're looking at information architecture, visual hierarchy, and positioning clarity. AcreOS passes all three.

> "How It Works: four steps, clear iconography, progressive disclosure. Import -> Analyze -> Outreach -> Close. That's a well-structured funnel. Reminds me of how Figma explains its workflow."

> "'Sophie, your AI copilot, scores leads, drafts offers, and surfaces the best opportunities.' -- Okay, so there's a named AI agent. That's a specific design choice. Not just 'we have AI features' but 'there's an agent named Sophie.' That implies something deeper than a ChatGPT wrapper."

**Comparable**: They benchmark against Pebble (market intelligence), REsimpli (CRM), and their custom ChatGPT prompts. AcreOS appears to combine all three.

**Verdict**: Category is immediately clear and the AI positioning resonates with their specific search intent.

---

## 2. VALUE PROP (60 seconds)

**Score: 4 / 5**

> "'AI Valuations powered by comps analysis and 18 open data sources.' -- 18 is a specific number. That's good. But which 18? Are these county assessor scrapes, USDA data, Census data? As a PM, I want the data architecture documented."

> "'AI Deal Intelligence' with Sophie -- I want to know: is this a rule-based scoring system or actual ML? If it's just weighted averages with an AI label, every tool claims that."

> "I see 'Campaign Automation' and 'Compliance Built-In' -- good, but these aren't AI features. These are CRUD features with automation. The AI claims are limited to valuations and deal scoring. Is there more?"

This visitor is the most discerning evaluator of AI claims. They know the difference between genuine ML inference and "if/then rules with an AI badge." The landing page makes AI claims but doesn't back them up with specifics.

> "What I DON'T see: no mention of natural language queries, no 'ask Sophie anything' interface, no RAG over my deal history, no predictive market models. The AI positioning is strong in the headline but thin in the feature details."

> "The social proof: '18 free data sources, $0 to start, 14-day trial, 500+ properties managed.' The '500+' is concerningly low. That's maybe 5-10 users? Early stage."

**Verdict**: The AI value prop opens strong but lacks the technical depth this visitor needs. They want to know HOW the AI works, not just THAT it exists.

---

## 3. PRICING (2 minutes)

**Score: 4 / 5**

> "Four tiers. Clean. The pricing page has a billing toggle -- monthly vs annual with 20% savings. Standard SaaS pattern, well-executed."

> "'AI Requests / day: Free 25, Starter 500, Pro 1,000, Scale Unlimited.' -- Okay so the AI is metered. That tells me it's probably calling LLM APIs behind the scenes. 25/day on free is enough to evaluate. 1,000/day on Pro is generous."

> "'BYOK Data Providers' on Pro -- 'Bring Your Own Key.' So I can plug in my own API keys for data services? That's a power-user feature I've never seen in a land CRM. Interesting."

> "Pro at $49/mo with BYOK, 1,000 AI requests, unlimited campaigns -- that's priced for indie operators, not enterprise. Makes sense for where they are."

> "One gap: no API access tier. I'd want to build automations with n8n or Make. If there's no API, BYOK is the closest thing, but it's not the same."

> "No usage-based pricing for overages. If I hit 1,000 AI requests in a day, do I just get cut off? Does it degrade? The pricing page doesn't say."

**Verdict**: Pricing is sensible and the AI metering is transparent. BYOK is a differentiator for power users. Missing API access and overage policy are minor gaps.

---

## 4. SIGNUP READINESS (5 minutes total)

**Score: 4 / 5**

> "Free tier with 25 AI requests/day. That's enough to test whether the AI is real or a wrapper. Signing up."

Auth page:

> "'The operating system for real estate professionals.' -- 'Operating system' is a bold claim. That implies it's a platform you live in, not a point solution. I like the ambition but let's see if the product earns it."

> "Clerk-powered auth. SSO with Google. Clean. No custom auth flow bugs. This tells me the team made good infra decisions -- Clerk over rolling their own auth."

Hesitations (from a PM perspective):
1. "Where's the changelog? No blog, no release notes, no 'what's new.' How active is development?"
2. "No mention of a public roadmap. If I'm going to invest my workflow in this, I need to know where it's going."
3. "No SOC 2, no security page, no privacy policy link on the landing page footer. For a tool that handles property data and financial info, that's a gap."
4. "No mobile app mentioned. The site is responsive but is there a native app? I check deals on my phone while commuting."

> "The landing page footer only has 'Pricing' and 'Sign In.' No blog, no docs, no changelog, no status page, no terms. That's a red flag for maturity."

**Verdict**: Signs up to evaluate. But notes multiple signals of early-stage product maturity that would delay a paid commitment.

---

## 5. FIRST-RUN MENTAL MODEL (5 min post-signup)

**Score: 4 / 5**

Onboarding: picks "active" path.

> "Path branching is well-designed. Beginner/Active/Enterprise maps to real user segments. The step progression for 'active' -- import portfolio, set counties, instant deal hunt, configure automation -- is a logical activation flow."

> "The Instant Deal Hunt: scanning a county and showing motivation-scored owners with offer/resale/profit estimates -- that's the aha moment. Even if the numbers are directional, showing REAL data from public records in real-time during onboarding? That's a strong first impression."

> "Wait -- 'Meet Atlas, Your AI Deal Partner' is in the beginner path but the landing page talked about 'Sophie.' Are there TWO AI agents? Or did they rename? That's a branding inconsistency."

They land on Today page:

> "Sidebar: Dashboard, CRM (with children), Campaigns, Inbox, AI Hub, Intelligence (with children), Finance, Settings. That's a deep nav tree. I count... 9 top-level items with roughly 25 sub-items visible. That's a lot."

> "'AI Hub' is a single top-level item -- so there IS a dedicated AI interface. 'Pax AI Insights' in the sidebar with a notification badge -- so there are AI agents running proactively? Pax, Sophie, Atlas -- how many AI entities are there?"

> "Intelligence section: Insights, Cohort Retention, AI Valuations, Land Credit, Markets, Counties, Acq. Radar, Document Intel, Compliance. That's 9 sub-items under Intelligence alone. This is a feature-dense product."

> "The GettingStartedChecklist gives direction. Business Pulse with a score. Agent Activity showing autonomous processes. This feels like a real operating system, not a toy."

> "Honest assessment: the product surface area exceeds what the landing page communicates. The landing page shows 6 feature cards. The actual product has 25+ modules. That's either impressive or concerning depending on depth vs breadth."

**Verdict**: Strong first-run. The product earns the "platform" claim. Multiple AI surfaces (Sophie, Atlas, Pax) are interesting but the naming is inconsistent with the landing page. The depth exceeds expectations set by the landing page.

---

## TOTAL SCORE: 21 / 25

**Summary**: AcreOS performs well with this tech-savvy evaluator. The AI positioning is what drew them in and the product delivers more AI surface area than the landing page promises (Pax insights, autonomous agents, multiple AI entities). Friction points: (1) AI claims on the landing page lack technical specificity -- no mention of models, training data, or architecture, (2) multiple AI agent names (Sophie, Atlas, Pax) create branding confusion, (3) missing signals of maturity (no changelog, blog, docs, security page, status page, terms/privacy in footer), and (4) the landing page undersells the product's actual feature depth. This visitor will spend 2+ hours exploring before forming a verdict on AI quality. The BYOK feature is a strong differentiator for power users.
