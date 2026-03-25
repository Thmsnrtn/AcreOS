# AcreOS White-Label Partnership Targets

## 1. Land Academy (Mark Podolsky / "The Land Geek")

**Audience:** 5,000+ students learning land investing through courses and coaching programs. The largest land investing education community.

**Current tools they recommend:** Pebble, various spreadsheet templates, generic CRM tools. No unified platform recommendation.

**Pitch:**

> Mark — I built a platform called AcreOS that does everything your students need in one place: deal finding, due diligence from 18 free government data sources, offer generation, campaign management, and seller-financed note tracking with Dodd-Frank compliance. I'd like to propose a white-label version for your students. They get the best tool available, you get $20-30 per seat per month in recurring revenue, and I handle all the engineering and support. The platform is already built — 400K lines of code, deploy-ready. Want to see a demo?

**Deal structure:**
- White-labeled under "Land Academy Tools" (or whatever Mark prefers)
- Revenue share: $20-30/seat/month to Mark's company
- AcreOS handles: engineering, hosting, support infrastructure
- Land Academy handles: distribution to students, first-line support (with scripts from AcreOS)
- Custom onboarding flow referencing Land Academy methodology

**How to reach:** mark@thelandgeek.com or through the Land Academy community forum

**Timeline expectation:** 2-4 weeks to first conversation, 2-3 months to partnership agreement, 1 month to white-label deployment

---

## 2. REtipster (Seth Williams)

**Audience:** 10,000+ blog readers, 3,000+ course students. Seth is the most trusted voice in land investing content. His tool recommendations carry significant weight.

**Current tools they recommend:** Various — Seth reviews tools on his blog and recommends different tools for different use cases. No exclusive partnership with any platform.

**Pitch:**

> Seth — I've been active in your community and I built a platform called AcreOS that I think your audience would get real value from. It integrates 18 free government data sources into automated due diligence, has a proprietary Land Credit Score (300-850 for land parcels), and handles the full workflow from deal finding to note servicing. Two options: (1) I'd love for you to review it on the blog — I'll give you full access. (2) If you're interested in going deeper, we could white-label it for your community. Your students get a branded tool, you get recurring revenue per seat.

**Deal structure:**
- Option A: Blog review + affiliate commission ($10/signup that converts)
- Option B: White-label "REtipster Tools" with $20-25/seat/month revenue share
- Custom integration with REtipster course materials (checklists, templates)

**How to reach:** seth@retipster.com — reference community engagement first

**Timeline expectation:** 1-2 months for review, 3-4 months for white-label if interested

---

## 3. Land Investor Accelerator (LIA)

**Audience:** Coaching program with ~200 active students doing their first or second land deals. High engagement, high willingness to pay for tools.

**Pitch:**

> Your students need software from day one. Right now they're each figuring it out independently — Pebble, spreadsheets, Mailchimp. What if you could hand them a fully built platform on day one of your program? AcreOS under your brand, pre-configured for your methodology, with your checklists and templates built in. Your students get a competitive advantage. You get recurring tool revenue on top of coaching fees.

**Deal structure:**
- White-label branded for LIA
- Bundled pricing: included in coaching fee or $15/seat/month add-on
- Revenue share: $15-20/seat/month to LIA
- Pre-configured with LIA-specific onboarding flow, checklists, and templates

**How to reach:** Through their website contact form or community

**Timeline expectation:** 2-3 months to partnership, 1 month to deploy

---

## 4. Land Mavericks Society

**Audience:** Community of ~500 active land investors. Mix of beginners and experienced operators.

**Pitch:**

> I built AcreOS as the operating system for land investors — deal feed, DD reports from 18 free data sources, campaigns, note management, compliance checking. I'm proposing a community-branded version for Land Mavericks members. Members get a discounted rate ($15/mo instead of $49), you get a revenue share per member, and the community benefits from shared market intelligence (anonymized, of course). It's a win for everyone.

**Deal structure:**
- Community-branded "Land Mavericks Tools"
- Member pricing: $15/mo (discounted from $49)
- Revenue share: $8-10/seat/month
- Community market intelligence: anonymized cross-member data improves county-level insights

**How to reach:** Through community leadership/admin

**Timeline expectation:** 2-3 months

---

## 5. Casual Fridays REI (Adam Southey)

**Audience:** Podcast listeners + community members. Growing audience focused on practical land investing.

**Pitch:**

> Adam — love the podcast. I built AcreOS and I think there's an opportunity to create a branded tool for your audience. Imagine "Casual Fridays Tools powered by AcreOS" — your listeners get a platform that handles everything (deal finding, DD, campaigns, notes), you get recurring revenue per user, and I handle the tech. I'm also happy to come on the podcast and talk about free government data sources for land investors — useful content for your audience regardless.

**Deal structure:**
- Branded under "Casual Fridays REI Tools"
- Revenue share: $15-20/seat/month
- Podcast sponsorship/appearance included in partnership

**How to reach:** Through the Casual Fridays website or Adam's social media

**Timeline expectation:** 2-4 months

---

## White-Label Technical Implementation

For all partnerships, the white-label deployment involves:

1. **Custom branding:** Logo, colors, domain (tools.landacademy.com, etc.)
2. **Custom onboarding:** Partner-specific investor type, checklists, and sample data
3. **SSO integration:** If the partner has an existing member portal, integrate SSO so members log in once
4. **Revenue tracking:** Stripe Connect for automated revenue share payments
5. **Shared infrastructure:** All white-labels run on the same AcreOS codebase with org-level branding configuration — no separate deployments

**Engineering effort:** 1-2 weeks per new white-label partner (branding, onboarding customization, SSO if needed).
