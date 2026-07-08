# 15. Customer Personas — Roles (slots 211–225)

**Core tension each persona navigates:** permission scoping vs functionality. VAs need read-only parcel views without seeing other clients' investments. Bookkeepers need QuickBooks-shaped exports without touching contract templates. Attorneys need form libraries without viewing tenant screening data. These 15 personas answer: *What view of AcreOS do I need to do my job, and what data must I never see?*

---

## 211. Catalina Ríos — VA / virtual assistant for an investor

**Lens:** Permission-scoped views; multi-client segregation. Filipino VA managing 3 investor clients. Obsessed with "I see Client A's deals, not B's and C's."

**State read:** Organizations table has `created_by` and `members` join. No per-role permission model. `/api/leads` returns all leads for org; Catalina's account has no filter on assignment.

**Highest-leverage move:** Role-scoped read-only view: Catalina logs in, sees ONLY leads assigned to her + her assigned properties. No view into co-investor comms, contract templates, or note ledger for other clients. Build `hasRoleScope()` helper in auth middleware. Effort: 2 weeks (role table + permission guards on 8 routes).

**Biggest risk:** Catalina accidentally sees Client B's tax returns in a shared folder; investor sues for breach of confidentiality.

---

## 212. Augusto Vergara — Bookkeeper for a small operation

**Lens:** QuickBooks-shaped exports; no customer-facing liability. Part-time books for 4 investors. Obsessed with "export P&L, trial balance, and 1098/1099 PDFs; I don't care about deal flow."

**State read:** `/api/financials/export` returns JSON. Augusto can access `/founder/financials` (admin surface). No bookkeeper-facing report bundle exists.

**Highest-leverage move:** Bookkeeper export pack: quarterly P&L (filtered by tax year), trial-balance CSV, 1098-INT + 1099-NEC bulk PDFs, late-fee schedule. Delivered via secure email link. Augusto never logs into the app; reports auto-mail on Jan 31 / Apr 30 / Jul 31 / Oct 31.

**Biggest risk:** Wrong trial-balance due to unrecorded transaction; Augusto catches it, but 48-hour fix window closes before filing deadline.

---

## 213. Renée Pendergrass — Transaction coordinator (TC)

**Lens:** Deadline tracking; closing-checklist discipline. Manages 40+ closings/yr. Obsessed with "3 days to close and title hasn't ordered the commitment."

**State read:** Deal detail shows contract date + expected close. No closing-checklist table. No "deadline in 72h" alert to TC inbox.

**Highest-leverage move:** Closing-checklist per deal: title order, inspection, final walkthrough, lender approval, wire transfer. Each item has due-date. Auto-email Renée 72h, 48h, 24h before each deadline. Mark items complete via email link. No app login needed.

**Biggest risk:** Renée misses title-order deadline (no alert); deal slips; buyer cancels; investor loses earnest-money.

---

## 214. Iolanda Pacheco — Real estate attorney (customer of AcreOS)

**Lens:** Template-library access without deal-specific data. Solo practice, 5 investor clients. Obsessed with "give me the note-purchase-agreement template in Delaware."

**State read:** Contract templates live in `/founder/contracts` (founder-only). Iolanda has no template library surface. Currently maintains her own template folder in Dropbox.

**Highest-leverage move:** Template-library portal: Iolanda logs in (invite-only), searches "note purchase" + filter by state, downloads PDF/docx, customizes locally. Can upload custom templates back to her own vault. No view into client deals, notes, or payments. Effort: 1 week (route + front-end).

**Biggest risk:** Iolanda uses outdated template (2023 vs 2025 statute); agreement is unenforceable; investor sues Iolanda for malpractice.

---

## 215. Hudson Drake — Broker who uses AcreOS for personal portfolio

**Lens:** Retail vs personal data segregation. Realtor-investor hybrid. Obsessed with "I show clients properties; I don't show them my personal deals."

**State read:** AcreOS is single-org, single-user-context. Hudson logs in; sees all leads + properties he's associated with (no segregation by role).

**Highest-leverage move:** Broker mode toggle: Hudson sets properties to "retail client" vs "personal investment" tags. On `/property-search`, retail properties are hidden from Hudson's personal P&L and deal-room invite list. Deal-room viewers (retail clients) never see his personal notes or financials.

**Biggest risk:** Hudson accidentally invites retail client into his personal deal-room; client sees his exit strategy and renegotiates after seeing his IRR target.

---

## 216. Marcellus Bremer — General contractor on retainer

**Lens:** Draw-schedule clarity without deal oversight. Builds for 2 flippers. Obsessed with "when is my next $20K draw, and how do I trigger it?"

**State read:** Rehab-budget table exists. No contractor portal or draw-schedule surface. Marcellus asks investor "when do I get paid" via text; no official surface of truth.

**Highest-leverage move:** Contractor draw-schedule portal: Marcellus logs in (invite), sees ONLY his assigned projects + draw schedule (e.g. "foundation complete = $20K draw on sign-off"). Click "draw ready" to request verification. Investor approves + wires. No view into contractor costs, other subs' budgets, or rehab ROI.

**Biggest risk:** Marcellus doesn't know he's underpaid relative to contract; quits mid-project; flipper scrambles to hire replacement.

---

## 217. Yelena Karpov — In-house property manager (1-employee PM company)

**Lens:** Tenant + maintenance workflow without owner financials. Manages 30 doors for 2 owner-operators. Obsessed with "ticket triage and rent collection, not owner's cap rate."

**State read:** Tenant entity + maintenance-ticket table live. `/properties` shows owner's occupancy goals and note terms (shouldn't be visible to PM).

**Highest-leverage move:** PM portal: Yelena logs in, sees 30 doors + current tenants + maintenance-ticket queue. Can triage tickets, send rent-reminder emails, pull lease-PDF. No view into rent roll P&L, owner's purchase price, cap-rate targets, or tenant-screening scores.

**Biggest risk:** Yelena quits; new PM learns owner's margins are higher than industry standard; negotiates better rate based on inside knowledge.

---

## 218. Solomon Achebe — In-house accountant (CPA at 4-person investing firm)

**Lens:** Tax-reporting export without deal-flow visibility. CPA managing books for 3 partners. Obsessed with "partner A's K-1 must match partner B's Schedule C perfectly."

**State read:** Org-level financials exist. No per-partner allocation table. No K-1/Schedule-C auto-generator.

**Highest-leverage move:** Partner-allocation module: Solomon inputs cap tables (Partner A 60%, Partner B 40%). System auto-allocates P&L by share. Generates K-1 forms (K1A income line, K1B capital gain) + Schedule-C summaries per partner. Exports to tax-prep software (TurboTax API integration). Effort: 3 weeks.

**Biggest risk:** K-1 doesn't reconcile to 1099-INT + 1098-INT; IRS audit; partners pay penalties for inconsistent reporting.

---

## 219. Nadira Khoury — CFO of a small operation (~$2M GMV)

**Lens:** Cash-flow forecasting without deal-entry authority. Part-time CFO for 3 firms. Obsessed with "can we fund Q3 acquisitions from Q2 cash position?"

**State read:** Monthly P&L exists. No rolling 90-day cash-flow model. No pipeline-to-cash forecast (Q3 expected closings → cash impact on Q2-end balance).

**Highest-leverage move:** 90-day cash-flow dashboard: plug in expected closings (date + sale price / note interest / rent), show cash impact month-by-month. Nadira can run "if we close 3 land deals in June, cash position in July is..." scenarios without needing analyst to rebuild the model.

**Biggest risk:** Nadira forecasts incorrectly; firm over-commits to Q3 acquisitions; can't fund due diligence; misses deals.

---

## 220. Magdalena Pereyra — Marketing assistant in-org

**Lens:** Mail-merge for investor mailers without seeing deal details. Sends 500 yellow letters/month for 2 operators. Obsessed with "correct address field + no name typos."

**State read:** Pebble mailer integration exists. Magdalena has read access to leads table. Can see offer prices, investor notes (accidentally).

**Highest-leverage move:** Mail-merge data export: Magdalena logs in, selects "mailer campaign," gets CSV (address, recipient name, property street only). No offer price, ARV, investor notes. Can upload back completed campaign ID + tracking number. Effort: 1 week.

**Biggest risk:** Magdalena copies offer prices into email; accidentally sends to customer-list instead of vendor-list; prices disclosed to competitors.

---

## 221. Theo Nakamura — Executive assistant to investor founder

**Lens:** Calendar + email triage without operational view. Schedules founder's time, screens calls. Obsessed with "no calls during 1:1s with cofounders, even if it's the lender."

**State read:** Founder-dashboard shows all live deals + notifications. Theo's account (assistant) has full org access (overprivileged). No assistant-specific interface.

**Highest-leverage move:** Assistant portal: read-only calendar view (pull from Google Cal), email-summary digest (daily recap of investor inbound), do-not-disturb blocks (Founder's 1:1 Tuesdays = "no calls" flag visible to Theo). No deal detail, no P&L. Effort: 2 weeks.

**Biggest risk:** Theo accidentally accepts a deal-review call during founder's deep-work block; founder misses critical decision.

---

## 222. Bríd Doyle — Intern / junior analyst

**Lens:** Onboarding speed; limited-scope tasks. College intern, 20 hrs/wk. Obsessed with "I want to contribute on day 1, not week 2."

**State read:** No intern-tier role. Bríd either gets full access (risky) or read-only admin (boring, can't help). No gradual-responsibility ramp.

**Highest-leverage move:** Intern role: pull lead-data reports (address, sale price, ARV), tag properties with research notes, check tax-delinquent status via auto-sync. Can't create deals, import, or see private notes. After 4 weeks, promote to analyst (deal-analysis tasks). Effort: 1 week (role table + 4 read-only surfaces).

**Biggest risk:** Intern gets bored, quits week 2; investor loses onboarding momentum; has to re-do research.

---

## 223. Jurgen Müller — Retiring operator (selling portfolio)

**Lens:** Succession planning without ongoing operations. 60yo, retiring this year. Obsessed with "how do I hand over the portfolio to my son cleanly?"

**State read:** No transition-mode role. Jurgen either has full access (can undo successor's work) or none (can't advise). No co-pilot relationship.

**Highest-leverage move:** Advisor role: Jurgen logs in, sees all deals in read-only (for guidance), can leave voice-notes on properties ("son, this tenant pays 90 days late—expect adjustment"). Son (new operator) sees notes + can ask questions. Jurgen can't mutate data, but can mentor. Effort: 2 weeks (advisor table + annotation surface).

**Biggest risk:** Jurgen dies before knowledge transfer; son scrambles to learn tenant-history, deal-flow, vendor relationships; portfolio quality declines.

---

## 224. Adelaide Kingsley — Family member co-owner (non-active)

**Lens:** Read-only summary access; no operational authority. Sister of an active investor, co-owns 3 properties. Obsessed with "I want annual reports, not to run the day-to-day."

**State read:** Co-owner has full org access (can edit deals accidentally). No read-only co-owner role. No annual-report auto-generation.

**Highest-leverage move:** Co-owner summary report: annual cash distributions, property-level ROI, baseline vs target yield, tax documents (K-1). Adelaide receives PDF via email; doesn't need to log in. Read-only web view available if she wants to drill down. Effort: 1 week.

**Biggest risk:** Adelaide accidentally changes deal terms while looking for her K-1; brother discovers change 3 months later; portfolio metrics are wrong.

---

## 225. Pranesh Joshi — Succession planner (advisor to retiring operators)

**Lens:** Valuation-data export for portfolio-sale comps. Helps operators sell portfolios to funds. Obsessed with "show me all his deals, cohort-ready for buyer-DD."

**State read:** No external-advisor role. Pranesh either gets full access (can see private investor notes) or none (can't help with valuation).

**Highest-leverage move:** Valuation-export role: Pranesh accesses operator's portfolio (after signed NDA), exports cohort data (property address, purchase price, current rent, cap rate, tenant-quality) as anonymized PDF. Can add appraiser notes. Can't see private financing or personal notes. Effort: 2 weeks.

**Biggest risk:** Pranesh leaks details to competing buyer; valuation softens mid-sale; operator loses $500K.

---

## 226. Category-level synthesis: Customer Personas — Roles

**Top 5 recommendations clustered from the 15 memos:**

1. **Role-scoped permission model + auth middleware guards (Catalina, Hudson, Yelena, Solomon)** — VA / PM / bookkeeper / accountant personas all need different views of the same org. Build `hasRoleScope()` helper + 8 permission-guarded routes. Effort: 3 weeks.

2. **Async report-delivery portal (Augusto, Renée, Nadira, Magdalena)** — Stop building login UIs for roles that don't need daily logins. Bookkeeper, TC, CFO, marketing assistant all want email + link-based reports. Effort: 2 weeks (template engine + email delivery).

3. **Advisor / mentor co-pilot role (Jurgen, Pranesh, Iolanda)** — Retiring operators, external consultants, and attorneys need read-only + annotation capability. Build `advisory_notes` table + permission guards. Effort: 2 weeks.

4. **Contractor draw-schedule + payment-notification surface (Marcellus, Beau contractor, flip crew)** — Subs need single-source-of-truth draw schedule without seeing deal economics. Effort: 2 weeks.

5. **Intern / junior analyst role with gradual responsibility (Bríd, junior team members)** — Enable onboarding momentum for young staff without giving them mutation authority. Start with data-pull + research-tag tasks. Effort: 1 week (role table + 4 surfaces).

