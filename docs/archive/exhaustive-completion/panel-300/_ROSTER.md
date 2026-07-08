# 300-Persona Panel — Roster

**Date assembled:** 2026-05-08
**Question each persona answers:** *Where can AcreOS be deepened or refined? What's the single highest-leverage move from your lens?*

The 211-persona corpus (2026-05-01) and the 20-persona forward-looking
panel (2026-05-08) gave the platform two passes — "what's broken?" and
"how do we push forward?" This third pass widens the aperture: 20
disciplines × 15 specialists per discipline = 300 fresh sets of eyes.

Each persona reads:
- The current platform state (`MASTER-FINDINGS-RECONCILIATION.md`,
  `post-may1-resweep.md`, `_FORWARD-SYNTHESIS.md`).
- Selected prior-corpus memos when relevant to their lens.
- The actual codebase surfaces their lens cares about.

Memo shape (≤150 words each, strict so synthesis can cluster):
- **Lens:** what they care about
- **What I see:** state read, 2 sentences
- **Highest-leverage move:** 1 specific recommendation with file/route citation
- **Biggest risk:** 1 sentence

Each category file contains all 15 of its personas inline plus a
**category-level synthesis** at the bottom (top-5 recommendations
clustered from the 15 memos). The cross-category synthesis layer
reads only the 20 category-syntheses, not all 300 individual memos.

---

## Categories (20 × 15 = 300)

### 1. AI / ML Engineering (`ai-ml-eng.md`)
1. **Naoki Onishi** — Eval engineer · *Built Anthropic-internal eval harness; obsessed with deterministic post-checks for non-deterministic outputs.*
2. **Priya Krishnan** — Model-risk engineer · *Came from a top-10 bank's consumer-AI compliance team; obsessed with bias drift over time.*
3. **Ezra Mendelsohn** — Prompt engineer · *Optimized 40% of token cost out of a YC AI startup's stack; obsessed with prompt versioning.*
4. **Lin Wei** — RAG engineer · *Built retrieval for legaltech; obsessed with chunk-strategy + reranking quality.*
5. **Soren Lindqvist** — Fine-tuning engineer · *Trained domain-specific models for fintech; obsessed with when fine-tune > prompt.*
6. **Aria Patel** — LLMops engineer · *Productionized 200-org LLM router; obsessed with cost/latency tradeoffs.*
7. **Bastien Lefèvre** — Embeddings engineer · *Migrated from OpenAI to local embeddings at scale; obsessed with vector-store design.*
8. **Nia Okonkwo** — Agent engineer · *Built tool-calling agents for a CRM SaaS; obsessed with handoff failure modes.*
9. **Magnus Halvorsen** — AI safety reviewer · *Red-teamed Claude pre-launch; obsessed with prompt injection at scale.*
10. **Yumiko Saito** — Model deprecation engineer · *Lived through GPT-3.5 → GPT-4 → 4o transitions; obsessed with rollover playbooks.*
11. **Caelan Hughes** — Eval scaling engineer · *Scaled an eval corpus from 10 → 10,000 cases; obsessed with case-authoring velocity.*
12. **Devika Iyer** — AI observability engineer · *Built telemetry that flags hallucinations in production; obsessed with detection.*
13. **Theo Mbeki** — MLOps platform engineer · *Owned ML serving infra at a unicorn; obsessed with cold-start latency.*
14. **Renée Gauthier** — AI cost-ops engineer · *Cut $400K/yr from a SaaS LLM bill; obsessed with cache hit-rate.*
15. **Hiroshi Tanaka** — AI product manager · *Shipped 6 AI features at a 50-person company; obsessed with product-market fit per AI feature.*

### 2. Backend Software Engineering (`backend-eng.md`)
16. **Quentin Dubois** — Senior TS/Node engineer · *15-year polyglot; obsessed with type safety at API boundaries.*
17. **Aleksandra Nowak** — Distributed systems engineer · *Built event-driven systems at scale; obsessed with idempotency keys.*
18. **Reza Farahani** — Postgres DBA · *Tuned 50TB Postgres clusters; obsessed with index bloat and vacuum.*
19. **Imani Adebola** — Query optimization engineer · *Cut p99 query latency 80% at a fintech; obsessed with EXPLAIN ANALYZE.*
20. **Stellan Berg** — Schema architect · *Migrated a monolith to schemas-per-vertical; obsessed with foreign-key boundaries.*
21. **Cécile Tremblay** — Migration engineer · *Owns Drizzle/Atlas at a series-B; obsessed with reversible migrations.*
22. **Tomás Reyes** — Idempotency engineer · *Built payments idempotency for Stripe-like systems; obsessed with replay protection.*
23. **Ife Adeyemi** — Queue/worker engineer · *BullMQ + DLQ at scale; obsessed with backoff math.*
24. **Wolfram Becker** — Webhook engineer · *Receives 50M webhooks/day; obsessed with signature verification.*
25. **Lakshmi Iyengar** — Integration engineer · *Built 30 vendor integrations; obsessed with circuit breakers.*
26. **Yusuf El-Amin** — API design engineer · *RFC author of OpenAPI conventions; obsessed with versioning strategies.*
27. **Marisol Quintero** — REST contract engineer · *Owns API stability at a major SaaS; obsessed with breaking-change detection.*
28. **Jin-Ho Park** — API docs engineer · *Built docs.stripe.com-quality docs; obsessed with example coverage.*
29. **Brigid O'Sullivan** — Deprecation engineer · *Sunsetted v1→v2→v3 APIs without breaking customers; obsessed with sunset comms.*
30. **Idris Khan** — Polyglot performance engineer · *Profiled Rust + Go + Node side-by-side; obsessed with hot-path optimization.*

### 3. Frontend Software Engineering (`frontend-eng.md`)
31. **Saoirse Murphy** — Senior React engineer · *10 years React; obsessed with rendering correctness over cleverness.*
32. **Kael Sutherland** — RSC pioneer · *Shipped Next.js 14 RSC at scale; obsessed with server/client boundary discipline.*
33. **Beatriz Carvalho** — Accessibility engineer · *Audited 50+ apps for WCAG 2.2; obsessed with focus management.*
34. **Linus Andersson** — Design system engineer · *Owns Radix-shaped primitives; obsessed with composition vs configuration.*
35. **Yael Cohen** — TypeScript types engineer · *Wrote conditional-types tutorial cited 100k times; obsessed with type inference.*
36. **Diego Almeida** — Animation engineer · *Built Framer-Motion-quality micro-interactions; obsessed with 60fps under load.*
37. **Marit Sørensen** — Frontend performance engineer · *Cut LCP from 4.2s → 1.1s; obsessed with critical-path CSS.*
38. **Adira Goldstein** — Web vitals engineer · *Owns CrUX dashboards at scale; obsessed with INP and FID.*
39. **Kenji Watanabe** — Mobile web engineer · *Builds for Safari iOS; obsessed with iOS quirks.*
40. **Olufemi Akande** — PWA engineer · *Shipped offline-first apps; obsessed with service-worker correctness.*
41. **Henrietta Bauer** — CSP engineer · *Locked down a SaaS to strict CSP; obsessed with nonce strategy.*
42. **Sasha Volkov** — Bundling engineer · *Vite + esbuild deep dives; obsessed with tree-shake correctness.*
43. **Aurelia Ferraro** — Hydration engineer · *Debugged React hydration mismatches at scale; obsessed with diff strategy.*
44. **Tariq Mansour** — Form engineer · *Built React Hook Form + Zod patterns at scale; obsessed with validation timing.*
45. **Min-Jun Kim** — Table-render engineer · *Owned virtualized 100k-row tables; obsessed with windowing strategy.*

### 4. DevOps / SRE / Platform (`devops-sre.md`)
46. **Bartholomew Cross** — SRE primary · *On-call 5 years at a unicorn; obsessed with alert-fatigue reduction.*
47. **Veronika Ivanova** — On-call engineer · *Built incident response playbooks; obsessed with PagerDuty discipline.*
48. **Eitan Halpern** — Chaos engineer · *Ran chaos-monkey at scale; obsessed with failure-injection coverage.*
49. **Gabrielle LeClerc** — Fly platform engineer · *Migrated 40 apps to Fly; obsessed with edge regions.*
50. **Yusra Al-Sayed** — Postgres ops engineer · *Manages prod Postgres clusters; obsessed with WAL replication lag.*
51. **Jonas Eriksson** — Observability engineer · *Built Honeycomb-shape tracing at a series-B; obsessed with span fidelity.*
52. **Coralie Vincent** — IaC engineer · *Terraform + Pulumi expert; obsessed with drift detection.*
53. **Ranveer Bhattacharya** — Security ops engineer · *SecOps at a fintech; obsessed with key rotation.*
54. **Esperanza Mendez** — Runbook author · *Wrote 200 runbooks at a SaaS; obsessed with the 2am-junior-engineer test.*
55. **Hadrien Boucher** — Incident commander · *Led 50+ Sev-1s; obsessed with comms cadence.*
56. **Nadya Petrov** — Postmortem engineer · *Author of "blameless postmortem" practice; obsessed with five-whys discipline.*
57. **Tomasso Ricci** — Capacity planner · *Forecasted infra capacity at scale; obsessed with growth modeling.*
58. **Phelan Walsh** — Multi-region engineer · *Built active-active across 3 regions; obsessed with replication consistency.*
59. **Ananya Desai** — Disaster recovery engineer · *Ran 100+ DR drills; obsessed with restore time vs RTO target.*
60. **Janosch Vogel** — Deploy engineer · *Built blue/green at scale; obsessed with rollback automation.*

### 5. Security / Compliance (`security-compliance.md`)
61. **Caspian Drake** — CISO · *2 prior CISO seats; obsessed with SOC 2 evidence collection.*
62. **Ife Adejumo** — Application security engineer · *Pen-tested 100+ apps; obsessed with auth flaws.*
63. **Bjorn Karlsson** — Infrastructure security engineer · *Owns cloud hardening at a unicorn; obsessed with IAM tightening.*
64. **Magdalena Kowalski** — Pentest red team · *25 years offensive security; obsessed with chained vulns.*
65. **Devon Mitchell** — Blue team engineer · *Builds detection at scale; obsessed with TTPs over IOCs.*
66. **Ravi Krishnan** — SOC 2 auditor · *Big 4 audit partner; obsessed with control evidence quality.*
67. **Ottilie Andersen** — GDPR DPO · *Advises 50+ EU SaaS; obsessed with data-minimization discipline.*
68. **Maya Patel** — CCPA compliance engineer · *Built CCPA stack at a martech SaaS; obsessed with the "do not sell" toggle.*
69. **Wynne Ohaegbu** — FCRA compliance lawyer · *Plaintiff-side; obsessed with adverse-action notice substantive form.* *(returns from forward panel)*
70. **Augusto Salinas** — TILA compliance · *25 years mortgage compliance; obsessed with disclosure timing.*
71. **Xiomara Beltrán** — RESPA compliance · *Title-side; obsessed with referral-fee chain analysis.*
72. **Itzel Ramos** — AML compliance · *Bank Secrecy Act; obsessed with SAR triggers.*
73. **Galen Boyd** — KYC engineer · *Built identity verification flows; obsessed with edge-case identity proofing.*
74. **Penelope Achterberg** — PCI DSS auditor · *PCI Level-1 compliance; obsessed with cardholder-data scope reduction.*
75. **Inigo Vargas** — Attack surface analyst · *Maps adversarial surface for breach response; obsessed with reachability.*

### 6. Product Design / UX (`product-design-ux.md`)
76. **Lyra Henriksen** — Senior product designer · *Designed at Linear and Notion; obsessed with progressive disclosure.*
77. **Anand Krishnamurthy** — UX researcher · *Conducted 500+ user interviews; obsessed with diary studies.*
78. **Soraya Najafi** — Customer journey mapper · *Built service blueprints for SaaS; obsessed with backstage handoffs.*
79. **Quill Jansen** — Microcopy writer · *Wrote at MailChimp + Stripe; obsessed with the apology shape.*
80. **Zelda Constantine** — Brand designer · *Owns brand at a Series-B SaaS; obsessed with voice consistency.*
81. **Octave Pellerin** — Illustrator · *Designed empty-states + onboarding illustrations; obsessed with character continuity.*
82. **Maeve Sullivan** — Motion designer · *Owns micro-interactions at a fintech; obsessed with acceleration curves.*
83. **Kazue Yamamoto** — Design system PM · *Built tokens + components for 500-eng org; obsessed with adoption metrics.*
84. **Reinier Visser** — Accessibility designer · *Designs for screen-reader first; obsessed with ARIA fidelity.*
85. **Pilar Ortega** — Mobile UX designer · *Designs touch-first; obsessed with thumb-zone placement.*
86. **Iulius Marin** — Voice/AI UX designer · *Designed Google Assistant flows; obsessed with conversation repair.*
87. **Sigrid Bjørnsen** — Dark-mode designer · *Owns dark-mode at scale; obsessed with contrast pairing.*
88. **Esperanza Iglesias** — Internationalization UX · *Localized 12 languages; obsessed with text-expansion budgets.*
89. **Calliope Demetriou** — Error-state UX · *Wrote the canonical "error states" deck; obsessed with recovery affordances.*
90. **Tobias Reuter** — Empty-state UX · *Designs onboarding empty-states; obsessed with first-day-hero framing.*

### 7. Engineering Leadership (`eng-leadership.md`)
91. **Vesper Holloway** — VP Engineering · *Scaled eng 10 → 200; obsessed with team-shape decisions.*
92. **Roan Pakulski** — CTO · *3rd-time CTO; obsessed with build-vs-buy at every layer.*
93. **Hadiya Mansour** — Engineering manager · *EM at a Series-C; obsessed with 1:1 cadence.*
94. **Cyrus Pendleton** — Staff engineer · *15-year IC; obsessed with the technical-decision doc.*
95. **Olivia Rasmussen** — Tech lead · *Leads 8-person team; obsessed with weekly demo discipline.*
96. **Pasha Yeremenko** — Principal engineer · *Owns architecture at a unicorn; obsessed with ADR culture.*
97. **Hannelore Schmitt** — Distinguished engineer · *25 years; obsessed with knowing when to disagree-and-commit.*
98. **Kaapo Lindholm** — Developer advocate · *Built DX at 3 dev tools; obsessed with onboarding-time-to-first-API-call.*
99. **Elara Voss** — Hiring lead · *Designed eng interview loops at scale; obsessed with calibration drift.*
100. **Devanshi Shroff** — L&D lead · *Built engineering ladders; obsessed with promotion criteria clarity.*
101. **Oren Brandt** — RFC author · *Architected RFC process at scale; obsessed with comment-density discipline.*
102. **Ingrid Solberg** — Architecture review board · *Chairs ARB; obsessed with API stability over time.*
103. **Maxim Kornilov** — Engineering blog editor · *Edits engineering blog at a public-eng-brand co; obsessed with author voice.*
104. **Yara Castillo** — OSS lead · *Maintains widely-used OSS; obsessed with contributor onboarding.*
105. **Bartolomeu Pinto** — Engineering brand · *Owns "best place for SWEs" narrative; obsessed with stack visibility.*

### 8. Product Leadership (`product-leadership.md`)
106. **Niamh Riordan** — CPO · *2nd CPO; obsessed with the wedge-deepening discipline.*
107. **Fenella Drummond** — VP Product · *Owns 8 PMs; obsessed with roadmap-resourcing math.*
108. **Tariq Sayed** — Principal PM · *Owns platform PM; obsessed with API-as-product framing.*
109. **Matías Nuñez** — Growth PM · *Built PLG flywheel at a unicorn; obsessed with activation-to-retention attribution.*
110. **Asma Bouzidi** — Platform PM · *Owns developer experience; obsessed with internal-tooling DX.*
111. **Cassiel Roux** — AI PM · *Shipped 4 AI features post-ChatGPT; obsessed with eval-driven iteration.*
112. **Wendell Hart** — Vertical PM (Land) · *12-year operator; obsessed with deepening Land before widening.* *(returns)*
113. **Marlena Lansdale** — Vertical PM (Notes) · *Built note-investing tooling for an institutional desk; obsessed with amortization correctness.*
114. **Renske de Vries** — Vertical PM (BH) · *Property management background; obsessed with FCRA-safe screening.*
115. **Hugo Beaufort** — Vertical PM (FF) · *Fix-and-flip operator; obsessed with rehab-budget realism.*
116. **Imelda Costa** — Vertical PM (Wholesaler) · *Wholesaler operator; obsessed with assignment legality per state.*
117. **Leyla Aydın** — Vertical PM (Subdivider) · *Land subdivider operator; obsessed with permit-tracker realism.*
118. **Roderick Gould** — Enterprise PM · *Sold to mid-market; obsessed with seat math.*
119. **Tegan Russo** — Monetization PM · *Pricing strategist; obsessed with price-elasticity discipline.* *(returns)*
120. **Camila Reyes** — Lifecycle PM · *Owns onboarding-to-renewal; obsessed with churn-axiomatic design.* *(returns)*

### 9. Executive / Strategy (`executive-strategy.md`)
121. **Asher Klein** — CEO · *Founder voice; obsessed with narrative coherence.* *(returns)*
122. **Olu Adebayo** — COO · *Operations at scale; obsessed with the runbook discipline.* *(returns)*
123. **Marisol Vega** — CFO · *Series-A diligence-readiness; obsessed with legible numbers.* *(returns)*
124. **Caspar Ng** — CRO · *Vertical-SaaS sales orgs; obsessed with named-account playbook.* *(returns)*
125. **Ana Solis** — CMO · *Brand + category-design; obsessed with masthead-architecture decisions.* *(returns)*
126. **Hatim Belkacem** — Chief of Staff · *Runs CEO operating cadence; obsessed with weekly-business-review discipline.*
127. **Zara Pemberton** — VP BizOps · *Quant-shaped ops; obsessed with KPI-tree clarity.*
128. **Espen Gulbrandsen** — VP Strategy · *Strategy consulting background; obsessed with comp-set benchmarking.*
129. **Vianey Castaneda** — VP Partnerships · *Built partner programs; obsessed with co-sell motion.*
130. **Padraig Macdonald** — VP Legal / GC · *In-house counsel at SaaS; obsessed with contract-template stewardship.*
131. **Nour Haddad** — GM Enterprise · *Owns enterprise BU; obsessed with custom-SLA discipline.*
132. **Soren Lindgren** — GM SMB · *Owns SMB BU; obsessed with self-serve-vs-touch-sales math.*
133. **Helena Brueggemann** — Board chair · *Independent board chair; obsessed with executive-cadence discipline.*
134. **Tomek Wisniewski** — Board observer · *Series-A observer; obsessed with quarterly-board-deck quality.*
135. **Bridget Ó Faoláin** — Advisory board member · *3rd-time advisor; obsessed with founder-advisor cadence.*

### 10. Investors / Capital (`investors-capital.md`)
136. **Ashok Bhatt** — Series-A lead · *Vertical-SaaS thesis; obsessed with TAM defensibility.* *(returns)*
137. **Lucette Marchand** — Growth-stage VC · *Series B-C check-writer; obsessed with magic-number math.*
138. **Hideki Yamashita** — Sector VC (proptech) · *Proptech-only fund; obsessed with vertical comp multiples.*
139. **Frances Whitcomb** — Angel investor · *Operator-turned-angel; obsessed with founder-market-fit.*
140. **Constantin Iliescu** — Family office principal · *Multi-asset; obsessed with downside protection.*
141. **Adaeze Nwankwo** — Debt provider · *Venture debt; obsessed with revenue covenants.*
142. **Bryn Halliday** — Public-markets equity analyst · *Sell-side proptech; obsessed with comp-multiple anchoring.* *(returns)*
143. **Peregrine Halsey** — IPO banker · *Lead-left on 30 IPOs; obsessed with NRR ≥120% pre-S1.*
144. **Harlowe Stone** — M&A advisor · *Sell-side advisor; obsessed with data-room cleanliness.* *(returns)*
145. **Sigourney Klemens** — Secondary buyer · *Buys secondary shares; obsessed with valuation-mark drift.*
146. **Edmund Hartley** — LP / fund-of-funds · *LP at a $5B fund; obsessed with fund-of-funds math.*
147. **Mariangela Rocco** — Private equity principal · *Mid-market PE; obsessed with EBITDA quality.*
148. **Tatsuya Iwasaki** — Corporate development · *AppFolio-shape acquirer; obsessed with strategic-fit assessment.*
149. **Aleksei Smirnov** — Sovereign wealth · *SWF tech allocator; obsessed with policy-aligned investment.*
150. **Júlia Almeida** — Micro-VC · *Pre-seed / seed; obsessed with founder-grit signaling.*

### 11. Sales / GTM / Revenue (`sales-gtm.md`)
151. **Hollis Marbury** — AE SMB · *Closes $5K-$25K ACVs; obsessed with the discovery-question ladder.*
152. **Soraya Mahmoud** — AE mid-market · *Closes $50K-$250K ACVs; obsessed with multi-thread discipline.*
153. **Geoffrey Pendlebury** — AE enterprise · *Closes $500K+ ACVs; obsessed with security-review cycle time.*
154. **Brielle Kowalczyk** — SDR lead · *Built SDR org from 0 → 30; obsessed with cadence-tool ergonomics.*
155. **Aaron Yamashita** — BDR · *Outbound prospector; obsessed with personalized-at-scale outbound.*
156. **Camila Espinosa** — Sales engineer · *Pre-sales SE; obsessed with PoC-to-paid conversion.*
157. **Rohan Mahapatra** — RevOps engineer · *Owns sales infra; obsessed with attribution model integrity.*
158. **Saskia Wojcik** — Sales enablement · *Trains AE org; obsessed with ramp-time reduction.*
159. **Eli Sutherland** — Pipeline analyst · *Forecast accuracy; obsessed with stage-conversion truth.*
160. **Brigid O'Halloran** — Customer evangelist · *Field marketing-ish; obsessed with customer-story production.*
161. **Yannis Kazantzakis** — Partnerships lead · *Built channel programs; obsessed with co-sell motion.*
162. **Marit Larsen** — Channel sales · *Sells through resellers; obsessed with margin-share discipline.*
163. **Devereux Holloman** — Sales coach · *Coaches AEs; obsessed with deal-review inspection.*
164. **Ananya Reddy** — Deal desk · *Approves non-standard pricing; obsessed with discount-discipline limits.*
165. **Ezekiel Faulkner** — Sales-marketing alignment lead · *Owns SLA between sales and demand; obsessed with lead-quality scoring.*

### 12. Marketing / Growth (`marketing-growth.md`)
166. **Mireille Saint-Clair** — Head of growth · *PLG growth-loops; obsessed with viral-coefficient discipline.* *(returns)*
167. **Diego Marchetti** — Community manager (returns) · *Notion + Linear playbook; obsessed with founder-led cadence.* *(returns)*
168. **Calista Pemberton** — SEO lead · *Built SEO at SaaS; obsessed with topical-authority pyramids.*
169. **Tehilah Aaronson** — Content marketing lead · *Built content engine at scale; obsessed with brand-voice consistency.*
170. **Kwame Asante** — PMM · *Product marketing at scale; obsessed with positioning-statement discipline.*
171. **Ivete Batista** — Brand marketing · *Brand campaigns at proptech SaaS; obsessed with brand-equity measurement.*
172. **Hjalmar Lindberg** — Performance marketing · *Owns paid acquisition; obsessed with LTV/CAC discipline.*
173. **Yulia Volkova** — Lifecycle marketing · *Builds drip campaigns; obsessed with cadence + cool-off design.*
174. **Idalia Roque** — Social media manager · *Owns social presence; obsessed with founder-voice-on-Twitter discipline.*
175. **Caelum Zalewski** — Partnerships marketing · *Co-marketing with vendors; obsessed with co-branded-asset quality.*
176. **Persephone Drake** — Events lead · *Owns conference circuit; obsessed with event-ROI math.*
177. **Bertram Whitcombe** — PR lead · *Press relations at SaaS; obsessed with embargo discipline.*
178. **Anouk de Jong** — Influencer marketing · *Built creator program; obsessed with disclosure compliance.*
179. **Halldór Sigurðsson** — Video / podcast producer · *Long-form content; obsessed with episode-discoverability.*
180. **Farah Sadeghi** — ABM lead · *Account-based marketing; obsessed with target-account orchestration.*

### 13. Customer Success / Support (`cs-support.md`)
181. **Camila Reyes** — Head of CS · *(seat already counted in product-leadership 120; here she's wearing a CS leader hat — different lens, deeper sweep.) Obsessed with health-score taxonomy.* *(returns)*
182. **Søren Christensen** — CSM SMB · *Owns 80 accounts; obsessed with 1:many-CSM motion.*
183. **Aditi Bhattacharyya** — CSM enterprise · *Owns 6 named accounts; obsessed with QBR cadence.*
184. **Marcel Kowalski** — Support engineer · *Tier-2 support; obsessed with reproducer-quality.*
185. **Petronella Rietveld** — Onboarding specialist · *Owns first-30-day onboarding; obsessed with milestone discipline.*
186. **Anouk Dewulf** — Training engineer · *Builds customer training; obsessed with curriculum design.*
187. **Yael Ben-David** — Knowledge base author · *Wrote 1,200 KB articles; obsessed with searchability.*
188. **Tomohiro Sato** — Community manager (paid) · *Owns paid community; obsessed with active-reader vs lurker math.*
189. **Aurelio Castaño** — Voice-of-customer lead · *Aggregates customer feedback; obsessed with feedback-to-roadmap loop.*
190. **Esmé Dansereau** — NPS analyst · *Owns NPS instrumentation; obsessed with sentiment-tagging discipline.*
191. **Lakshman Reddy** — Expansion CS · *Owns expansion-only motion; obsessed with feature-adoption-as-leading-indicator.*
192. **Brid O'Connor** — Retention CS · *Owns "save the customer" motion; obsessed with churn-call cadence.*
193. **Magnus Ingvarsson** — Escalation manager · *Handles top-of-pyramid customer issues; obsessed with executive-comms.*
194. **Yui Nakahara** — Support ops · *Owns support tooling; obsessed with response-time SLA.*
195. **Cyril Béjart** — CS-product liaison · *Sits between CS and product; obsessed with feedback-prioritization framework.*

### 14. Customer Personas — Verticals (`customers-verticals.md`)
196. **Wendell Hart** — Land investor (TX, 12yr veteran) · *Already a known customer-archetype; obsessed with deal-pipeline depth.* *(returns)*
197. **Sasha Donovan** — Land investor (newbie, 2-month customer) · *First-time investor; obsessed with reducing fear-of-mistakes.*
198. **Roger Beauchamp** — Land + flip side hustle · *2 deals/yr while W-2 employed; obsessed with weekend-only workflow.*
199. **Marlena Lansdale** — Note investor (institutional, 4,000+ note portfolio) · *Already PM-archetype; here as customer; obsessed with amortization to the cent.*
200. **Bart Henrichsen** — Note investor (individual, 12 notes) · *Retired, manages his own notes; obsessed with simplicity over features.*
201. **Henrietta Volker** — BH operator (1 unit, just-bought) · *First-time landlord; obsessed with not-getting-sued.*
202. **Octavio Pereira** — BH operator (multi-state, 80+ units) · *25-year landlord; obsessed with portfolio-level KPIs.*
203. **Karina Petrov** — Wholesaler (assignment, 30 deals/yr) · *2 years wholesaling; obsessed with assignability-state-rules.*
204. **Beau Gentry** — Wholesaler (double-close, 100 deals/yr) · *5 years; obsessed with title-coordination workflow.*
205. **Eulalia Mendoza** — Fix-and-flipper (single project at a time) · *Solo flipper; obsessed with rehab-budget creep.*
206. **Tobias Crawford** — Fix-and-flipper (multi-project, 4 simultaneous) · *Manages 4 contractors; obsessed with project-status visibility.*
207. **Ingvar Sigurdsson** — Subdivider (rural land, 100-acre tracts) · *Sells 5-10 acre parcels; obsessed with permit-tracker.*
208. **Yvonne Bertrand** — Subdivider (suburban, in-fill lots) · *Splits city lots; obsessed with zoning research.*
209. **Magnus Ó Brolcháin** — Multi-vertical operator (Land + Notes + BH) · *Cross-vertical operator; obsessed with unified P&L.*
210. **Imani Whitfield** — Side-hustle to full-time transition · *Going full-time this year; obsessed with revenue-replacement math.*

### 15. Customer Personas — Roles (`customers-roles.md`)
211. **Catalina Ríos** — VA / virtual assistant for an investor · *Filipino VA, 3 investor clients; obsessed with permission-scoped views.*
212. **Augusto Vergara** — Bookkeeper for a small operation · *Part-time books for 4 investors; obsessed with QuickBooks-shaped exports.*
213. **Renée Pendergrass** — Transaction coordinator · *Manages closings; obsessed with deadline tracking.*
214. **Iolanda Pacheco** — Real estate attorney (customer of AcreOS) · *Solo practice; obsessed with template-library access.*
215. **Hudson Drake** — Broker who uses AcreOS for personal portfolio · *Realtor-investor hybrid; obsessed with separating retail-vs-personal data.*
216. **Marcellus Bremer** — General contractor on retainer · *Builds for 2 flippers; obsessed with draw-schedule clarity.*
217. **Yelena Karpov** — In-house property manager (1-employee) · *Manages 30 doors; obsessed with maintenance-ticket triage.*
218. **Solomon Achebe** — In-house accountant · *CPA at a 4-person investing firm; obsessed with tax-export to TurboTax.*
219. **Nadira Khoury** — CFO of a small operation (~$2M GMV) · *Part-time CFO for 3 firms; obsessed with cash-flow forecasting.*
220. **Magdalena Pereyra** — Marketing assistant in-org · *Manages mailers + social; obsessed with mail-merge correctness.*
221. **Theo Nakamura** — Executive assistant to investor founder · *Schedules + email triage; obsessed with founder-time protection.*
222. **Bríd Doyle** — Intern / junior analyst · *College intern; obsessed with onboarding speed.*
223. **Jurgen Müller** — Retiring operator (selling portfolio) · *60yo, retiring this year; obsessed with succession-planning workflow.*
224. **Adelaide Kingsley** — Family member co-owner (non-active) · *Sister of an active investor; obsessed with read-only summary access.*
225. **Pranesh Joshi** — Succession planner (advisor to retiring operators) · *Helps operators sell portfolios; obsessed with valuation-data export.*

### 16. Domain Experts — Real Estate (`domain-real-estate.md`)
226. **Linnea Holstein** — Title agent · *Owns title operations at a 2-state agency; obsessed with title-search-completeness.*
227. **Cosima Bianchi** — Escrow officer · *Manages escrow accounts; obsessed with disbursement reconciliation.*
228. **Bartholomew Reeves** — County assessor · *Public-records professional; obsessed with parcel-data accuracy.*
229. **Phaedra Andros** — Recorder of deeds · *County recorder; obsessed with deed-language compliance.*
230. **Ferdinand Vargas** — Real estate attorney · *Transactional; obsessed with template-state-stewardship.*
231. **Margolis Stein** — 1031 exchange intermediary · *Qualified intermediary; obsessed with timeline-discipline (45/180 day rules).*
232. **Hilarie Fontaine** — Land surveyor · *Boundary surveys; obsessed with metes-and-bounds digitization.*
233. **Reid Halverson** — Appraiser · *Residential + land; obsessed with comp-set defensibility.*
234. **Abebi Adeyemi** — Environmental consultant · *Phase I/II ESAs; obsessed with environmental-disclosure quality.*
235. **Yann Petit** — MLS data analyst · *Owns MLS feeds; obsessed with data-license terms.*
236. **Solveig Berntsen** — Public records researcher · *Pulls courthouse records; obsessed with record-currency.*
237. **Henrik Christensen** — GIS specialist · *Maps + parcel data; obsessed with coordinate-system fidelity.*
238. **Imogen Strand** — Lien searcher · *Searches for liens pre-close; obsessed with lien-type taxonomy.*
239. **Ruairidh MacLeod** — BPO/CMA analyst · *Broker price opinions; obsessed with CMA-defensibility.*
240. **Lev Berkovich** — Foreclosure auctioneer · *Trustee sales; obsessed with bid-day operations.*

### 17. Vendor Partners (`vendor-partners.md`)
241. **Stripe Partner Manager** — *Stripe-side relationship; obsessed with Stripe Connect / Tax adoption metrics.*
242. **Clerk DX Lead** — *Clerk-side; obsessed with auth-flow conversion benchmarks.*
243. **AWS Solutions Architect** — *Account team; obsessed with cost-optimization recommendations.*
244. **Twilio CSM** — *Account team; obsessed with 10DLC + carrier-relationship tier.*
245. **OpenAI Partnerships Lead** — *Account team; obsessed with model-deprecation playbook adoption.*
246. **Anthropic Partnerships Lead** — *Account team; obsessed with safety-eval adoption.*
247. **Lob Partner Manager** — *Direct mail; obsessed with print-vendor SLA.*
248. **Cloudflare Partner Engineer** — *Edge + R2; obsessed with WAF rule customization.*
249. **Sentry Customer Success** — *Account team; obsessed with PII-scrubbing rule coverage.*
250. **Fly.io Support Engineer** — *Direct support; obsessed with machine-failover playbook.*
251. **Dropbox Sign Partner** — *Account team; obsessed with idempotency-pattern adoption.*
252. **Plaid Partner Manager** — *Bank-data; obsessed with consent-renewal cadence.*
253. **Mapbox / Google Maps account exec** — *Mapping; obsessed with quota-tier tuning.*
254. **Regrid Customer Success** — *Parcel-data; obsessed with API-rate-limit fit.*
255. **Snyk / FOSSA license auditor** — *License compliance; obsessed with copy-left detection.*

### 18. Adversarial / Stress (`adversarial-stress.md`)
256. **Ophelia Brennan** — Plaintiff FCRA attorney · *Class-action FCRA practice; obsessed with adverse-action-paper-trail gaps.*
257. **Heath Macaulay** — Plaintiff TILA attorney · *Truth-in-Lending claims; obsessed with disclosure-timing violations.*
258. **Sumayyah Idris** — Plaintiff RESPA attorney · *Real estate settlement claims; obsessed with referral-fee chains.*
259. **State AG Civil Rights division** — *State investigator; obsessed with disparate-impact patterns.*
260. **CFPB Enforcement Lead** — *Federal regulator; obsessed with consumer-finance complaint patterns.*
261. **Bryce Henningsen** — Short-seller / activist analyst · *Public-markets short; obsessed with revenue-quality red flags.*
262. **Anya Greenberg** — Investigative journalist (Bloomberg/The Information shape) · *Tech-business reporter; obsessed with leak-friendly internal docs.*
263. **Fjorde Karlsson** — Disgruntled customer ("you ruined my deal") · *Deals-fell-through-blames-AcreOS; obsessed with public Twitter blame.*
264. **Calixto Ramos** — Churning customer (silent ghost) · *Just stopped using; obsessed with what's-keeping-me motion.*
265. **Edmund Calloway** — Abusive operator (using AcreOS to harass tenants) · *FCRA-violator hiding behind AcreOS; obsessed with finding loopholes.*
266. **Fraudster account-takeover specialist** · *Asher-takeover-redux; obsessed with bypassing RS-4..RS-7 controls.*
267. **Galvin Thorpe** — Social engineer (calls support pretending to be founder) · *Vishing operator; obsessed with helpdesk-bypass.*
268. **Velda Crispin** — Data scraper / competitor · *Scrapes public surfaces; obsessed with rate-limit evasion.*
269. **DDoS attack coordinator** · *L7 floods; obsessed with WAF-evasion patterns.*
270. **Mei-Lin Park** — GDPR opt-out / data-erasure aggressor · *Files DSARs to test compliance; obsessed with response-deadline accuracy.*

### 19. Adjacent Industries / Outside-In (`adjacent-industries.md`)
271. **Yusra Al-Hamadi** — Fintech ops engineer · *Built ops for a payments unicorn; obsessed with reconciliation discipline.*
272. **Hugo Nilsson** — Healthcare HIPAA engineer · *EHR compliance; obsessed with PHI-segregation patterns.*
273. **Caroline Whitlock** — Insurance underwriter · *Cyber + E&O carrier-side; obsessed with control-attestation evidence.*
274. **Augustin Petracci** — Legaltech executive · *Doc-automation SaaS; obsessed with template-versioning patterns.*
275. **Imelda Bautista** — Proptech competitor (Buildium/AppFolio shape) · *PMS competitor; obsessed with comparative-feature messaging.*
276. **Boris Andronov** — Banking compliance officer · *Bank-side; obsessed with BSA / AML reporting.*
277. **Soledad Iglesias** — Accounting SaaS exec · *QuickBooks-shape exec; obsessed with chart-of-accounts standardization.*
278. **Tate Henrichsen** — CRM SaaS PM · *Sales-CRM PM; obsessed with contact-source attribution.*
279. **Eitan Bar-Lev** — E-sign competitor · *DocuSign-shape eng; obsessed with audit-trail completeness.*
280. **Mariana Salgado** — Mortgage tech exec · *Loan-origination SaaS; obsessed with disclosure-timing automation.*
281. **Phineas Whittaker** — PMS competitor (single-vertical) · *Stessa-shape competitor; obsessed with single-vertical depth.*
282. **Yul Karimov** — Lien-data provider · *Sells lien data; obsessed with data-currency SLA.*
283. **Ruti Goldfarb** — ML/AI startup founder (adjacent vertical) · *Building AI for a different vertical; obsessed with eval-corpus authoring.*
284. **Dame Heloise Crewe** — Vertical SaaS exec (post-IPO) · *AppFolio veteran; obsessed with what-we-got-wrong storytelling.*
285. **Hilel Brunner** — Dev-tool exec · *Sells to developers; obsessed with DX as primary metric.*

### 20. Future / Emerging (`future-emerging.md`)
286. **Phoebe Lethbridge** — UK Buy-To-Let analyst · *International expansion; obsessed with US-feature portability audit.* *(returns)*
287. **Lachlan Murray** — AU NSW land-investing analyst · *AU stamp-duty; obsessed with jurisdictional product-fit.*
288. **Nadia Bourassa** — Canada proptech analyst · *Easier-than-UK first international beachhead; obsessed with provincial-variation handling.*
289. **Pelagia Vasiliou** — Web3 / tokenization advocate · *Real estate tokenization platform builder; obsessed with on-chain title.*
290. **Saskia Vermeulen** — AI-native operator (uses 5+ AI tools daily) · *Power-user investor; obsessed with AI-stack composability.*
291. **Tariq Bashir** — Voice-first user (uses voice during driving) · *Drives between properties; obsessed with hands-free workflow.*
292. **Bartolomé Espino** — Mobile-only user (no laptop) · *Operates entirely from phone; obsessed with mobile-form ergonomics.*
293. **Eilis Brennan** — Accessibility power-user (screen reader primary) · *Blind investor; obsessed with WCAG 2.2 AAA fidelity.*
294. **Ines Travers** — Sustainability / ESG analyst · *Climate-aware investing; obsessed with carbon-footprint-per-deal.* *(returns; here in different lens)*
295. **Hjördís Jónsdóttir** — Climate-risk insurer · *Underwrites climate exposure; obsessed with FEMA-flood-zone overlay correctness.*
296. **Cyrus Bahrami** — Ag-tech adjacent · *Precision-ag SaaS; obsessed with land-investor / farmer overlap.*
297. **Tindall Macfarlane** — Ranch operator · *5,000-acre ranch; obsessed with grazing-rotation tools.*
298. **Anika Pelletier** — Timber operator · *Timberland investor; obsessed with timber-volume-tracking.*
299. **Bhargav Reddy** — Conservation easement specialist · *Sells easements to investors; obsessed with appraisal-defensibility.*
300. **Olufunmi Akinwande** — Opportunity zone investor · *OZ tax-incentive aware; obsessed with deferred-gain calculation.*

---

## Returning personas (16 of 300 are panel-graduates from prior corpora)

To preserve continuity, 16 personas from the 211-corpus or 20-panel
return with their existing lens — they're the bridge between this
panel and prior work:

**From the 20-panel:** asher-klein, marisol-vega, olu-adebayo,
sam-reyes, ines-travers, theo-okuda, wendell-hart, yuna-park,
ashok-bhatt, harlowe-stone, tegan-russo, camila-reyes, ana-solis,
bryn-halliday, mireille-saint-clair, caspar-ng, wynne-ohaegbu,
phoebe-lethbridge, diego-marchetti.

**Their refresh task:** look at the platform with the *new lens*
this panel slot gives them. Wendell as a Land-vertical PM (slot 112)
sees different concerns than Wendell as an operator-customer (slot
196), even though it's the same person. Marisol as CFO (slot 123)
sees different concerns than Marisol as a sometimes-PM monetization
voice (slot 119). The duplications are intentional — different
seats produce different recommendations.

The 284 NEW personas have a 1-paragraph backstory beat in their
memo (last role, scar, current obsession) so the lens is concrete.

---

## Cross-category coordination

Each category file (e.g., `ai-ml-eng.md`) ends with a
**category-level synthesis** — top 5 recommendations clustered from
that category's 15 memos. The cross-category synthesis layer
(`_SYNTHESIS.md`) reads only those 20 category-syntheses, not all
300 raw memos. This keeps the synthesis layer tractable while
preserving the underlying raw data for re-mining later.

The top-level `_PLAN.md` is the deliverable: prioritized
30/90/180/365-day backlog, founder-judgment items, verification
gates. That's what the founder ships against.
