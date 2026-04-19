# Master Vocabulary Translation Table

Generated: 2026-04-18

Union of all terms from 8 competitor dossiers mapped to AcreOS's current terminology.
Source competitors: BatchLeads, DealMachine, Harvey AI, InvestorFuse, Pebble, Podio, PropStream, REsimpli.
AcreOS nav labels extracted from `client/src/components/layout-sidebar.tsx`.

Decision rule: if 3+ competitors use term X and AcreOS uses a different term Y, Action Needed = "ADOPT or TRANSLATE".

---

## Core Industry Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **Skip Tracing / Skip Trace** | 5 | BatchLeads, DealMachine, PropStream, REsimpli, Pebble (as "Parcel Data Pull") | Data enrichment (provider registry, no user-facing label) | RENAMED | ADOPT or TRANSLATE -- 5 competitors use "skip tracing" as a headline term. AcreOS should surface this term in Leads UI or rename enrichment actions to "Skip Trace" |
| **Driving for Dollars / D4D / Canvassing** | 5 | BatchLeads, DealMachine, PropStream, REsimpli, InvestorFuse (via DealMachine integration) | (none) | ABSENT | No action -- AcreOS is not a field-scouting tool. Document as out-of-scope |
| **Motivated Seller / Distressed Seller** | 4 | BatchLeads, DealMachine, PropStream, REsimpli | Leads (no distress taxonomy) | RENAMED | ADOPT or TRANSLATE -- add "Motivated Seller" as a lead tag/filter category or named list type. The term is industry-standard |
| **Comps / Comparable Sales** | 4 | BatchLeads, DealMachine, PropStream, Pebble (implied via property map) | AVM (AcreOS Valuation Model) | RENAMED | ADOPT or TRANSLATE -- "AVM" is technically precise but "Comps" is the term every investor uses. Add "Comps" as a subtitle or alias: "AVM (Comps)" |
| **Direct Mail / Mailers** | 6 | BatchLeads, DealMachine, Pebble, PropStream, REsimpli, InvestorFuse (via integrations) | Campaigns (includes direct mail in description) | ALIGNED | No action -- AcreOS correctly uses "Campaigns" as the umbrella with "direct mail" in the description text |
| **Pipeline / Deal Pipeline / Deal Flow** | 5 | BatchLeads ("Lead Pipeline"), DealMachine, InvestorFuse ("Lead Lifecycle"), Pebble ("Deal Board"), REsimpli ("Deal Pipeline") | Deal Pipeline | ALIGNED | No action -- AcreOS uses "Deal Pipeline" which matches industry consensus |
| **CRM / Contacts / Leads** | 7 | BatchLeads, DealMachine, InvestorFuse, Pebble, Podio, PropStream, REsimpli | Leads + Deals + Inbox (no single "CRM" label) | RENAMED | ADOPT or TRANSLATE -- consider adding "CRM" as a subtitle or meta-description. Users searching for "CRM" should find AcreOS. The sidebar could say "Leads (CRM)" or the dashboard could reference CRM |
| **Dispositions / Exit Strategies** | 3 | InvestorFuse ("Dead Reason" as disposition), REsimpli ("Dispositions"), Pebble (implied in Deal Board stages) | Dispositions (in Deals page, deal type = "disposition") | ALIGNED | No action -- AcreOS uses "Disposition" correctly as a deal type |
| **Wholesale / Wholesaling** | 4 | BatchLeads, DealMachine, PropStream (implied via "Flippers"), REsimpli | Referenced in onboarding wizard ("Wholesale land flipping") but not in nav | ABSENT | No action -- this is a strategy label, not a feature. Appropriately handled in onboarding |
| **Wholetail** | 0 | (none use this term) | (none) | ABSENT | No action -- term not used by competitors either |
| **Fix and Flip / Flip** | 3 | BatchLeads, DealMachine, PropStream (via "Rehab Calculator") | Referenced in onboarding wizard, not in nav | ABSENT | No action -- strategy label, appropriately handled in onboarding |
| **List Building / List Stacking** | 4 | BatchLeads ("Lead Lists"), DealMachine ("List Builder"), PropStream ("Lead Lists"), REsimpli ("List Building" + "List Stacking") | (none) | ABSENT | ADOPT or TRANSLATE -- "List Building" is a core top-of-funnel concept. If AcreOS adds external data search, adopt "List Builder" as the feature name |
| **Property Data / Data Enrichment** | 5 | BatchLeads ("Property Filters"), DealMachine ("Data Filters, 700 points"), PropStream ("160M+ properties"), REsimpli ("List Building"), Pebble ("Property Records") | Properties + data enrichment via provider registry | RENAMED | ADOPT or TRANSLATE -- AcreOS calls this "Properties" in nav. Consider adding a visible "Enrich" action button on property records. Users expect to see "Property Data" as a named capability |
| **Due Diligence / DD** | 3 | Harvey AI, Pebble ("Property Map" for DD), DealMachine (implied via deal analysis) | Due Diligence (property status in Properties page) | ALIGNED | No action -- AcreOS uses "Due Diligence" correctly |

---

## AI and Intelligence Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **Named AI Assistant** | 5 | BatchLeads (Reia AI), DealMachine (Alma), Harvey AI (Harvey), PropStream (PropStream Intelligence), REsimpli (VoiceFollow/CallAnswer/Conversational AI) | AI Hub / Pax | ALIGNED | No action -- AcreOS has "Pax" as its named AI. Consider making "Pax" more prominent in the sidebar label: "Pax (AI Hub)" |
| **AI Scoring / Lead Scoring** | 3 | BatchLeads (BatchRankAI), InvestorFuse (CallGrade AI), PropStream (PropStream Intelligence) | Land Credit (300-850 scoring) + Acq. Radar | RENAMED | No action -- AcreOS's scoring is more sophisticated (Land Credit + Acq. Radar). Terms are differentiated, not misaligned |
| **Workflow Agents** | 2 | Harvey AI ("Workflow Agents"), REsimpli (AI agents) | AI Hub | RENAMED | No action -- only 2 competitors use this term |
| **Speed to Lead** | 1 | REsimpli | (none) | ABSENT | No action -- only 1 competitor uses this term |

---

## Outreach and Communication Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **Sequences / Drip Campaigns / Auto Followups** | 5 | DealMachine ("Mail Sequences"), InvestorFuse ("Sequence"), Pebble ("Auto Followups"), REsimpli ("Drip Campaigns"), BatchLeads ("Outbound Campaigns") | Sequences | ALIGNED | No action -- AcreOS uses "Sequences" which is the most neutral/modern term |
| **Unified Inbox** | 2 | Pebble, REsimpli (implied) | Inbox | ALIGNED | No action -- "Inbox" is sufficient |
| **Call Tracking Numbers** | 2 | DealMachine, PropStream (Click-to-Dial) | (none) | ABSENT | No action -- telephony features are out of current scope |
| **Ringless Voicemail (RVM)** | 2 | REsimpli, Pebble (implied) | (none) | ABSENT | No action -- only 2 competitors |
| **Power Dialer / Dialer** | 3 | BatchLeads (Dialer AI), Podio (Power Dialer), PropStream (BatchDialer) | (none) | ABSENT | Monitor -- 3 competitors have dialers but this is a telephony feature outside AcreOS's core |

---

## Data and Analytics Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **KPI Dashboard** | 3 | InvestorFuse ("Employee Scorecard, 18 KPIs"), REsimpli ("KPI Dashboard"), Pebble (implied via Deal Board metrics) | Insights (Intelligence section) | RENAMED | ADOPT or TRANSLATE -- "KPI Dashboard" is more concrete than "Insights." Consider renaming or subtitling: "Insights (KPIs)" |
| **Heat Map** | 1 | PropStream | Maps | RENAMED | No action -- only 1 competitor |
| **Cost Per Lead / Cost Per Deal** | 2 | InvestorFuse, REsimpli | Insights (analytics) | RENAMED | No action -- only 2 competitors use as named concepts |
| **Cash Buyers / Buyer Lists** | 3 | BatchLeads, PropStream, REsimpli | Marketplace (Buy and sell deals) | RENAMED | ADOPT or TRANSLATE -- "Cash Buyers" is a known industry term. If AcreOS's Marketplace serves this function, consider adding "Cash Buyers" as a filter or section label |
| **MLS Data / On-Market / Off-Market** | 2 | BatchLeads, PropStream | (none) | ABSENT | No action -- MLS integration is out of current scope |

---

## Financial and Deal Structure Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **Accounting / Full Accounting** | 1 | REsimpli | Finance + Cash Flow | RENAMED | No action -- only 1 competitor |
| **Rehab Calculator / ARV** | 2 | PropStream ("Rehab Calculator"), BatchLeads ("ARV") | Tools (Calculators and utilities) | RENAMED | No action -- only 2 competitors, and AcreOS focuses on land (no rehab) |
| **Seller Financing / Notes** | 0 | (none) | Finance (Seller-financed notes) | ABSENT | No action -- this is an AcreOS differentiator that competitors lack |
| **Capital Markets / Note Securitization** | 0 | (none) | Capital Mkts | ABSENT | No action -- unique AcreOS feature |
| **Blind Offers** | 0 | (none) | Blind Offer Wizard | ABSENT | No action -- land-specific AcreOS feature |
| **Land Credit (scoring)** | 0 | (none) | Land Credit (300-850 scoring) | ABSENT | No action -- proprietary AcreOS scoring |

---

## Document and Compliance Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **Document Generation** | 2 | Pebble, Podio ("PDF Generation") | Documents | RENAMED | No action -- only 2 competitors |
| **E-Sign** | 2 | REsimpli, Podio ("ShareFile & e-signature") | (none in nav) | ABSENT | No action -- only 2 competitors |
| **DNC / Compliance Flags** | 1 | PropStream | Compliance | ALIGNED | No action |
| **Doc Intel / Contract Parsing** | 0 | (none) | Doc Intel | ABSENT | No action -- AcreOS-only feature |

---

## Platform and Workspace Terms

| Term | # Competitors Using It | Competitor Names | AcreOS Current Term | Status | Action Needed |
|---|---|---|---|---|---|
| **Workspaces** | 1 | Podio | (none -- single org model) | ABSENT | No action -- only 1 competitor |
| **No-Code Builder** | 1 | Podio | (none -- opinionated platform) | ABSENT | No action -- different architecture philosophy |
| **Custom Fields** | 2 | DealMachine, Podio | (none) | ABSENT | No action -- only 2 competitors |
| **Activity Feed / Activity Stream** | 2 | Pebble, Podio | (none as named concept) | ABSENT | No action -- only 2 competitors |
| **Academy / Education** | 2 | PropStream ("Academy"), Harvey AI ("Harvey Academy") | Help & Support | RENAMED | No action -- only 2 competitors, but worth monitoring |
| **Compare / Competitive Pages** | 1 | REsimpli | (none) | ABSENT | No action -- marketing strategy, not product vocabulary |

---

## Summary: Priority Actions

Terms that meet the 3+ competitor threshold and require AcreOS attention:

| # | Term to Adopt/Translate | Current AcreOS Term | Competitors Using | Recommended Action |
|---|---|---|---|---|
| 1 | **Skip Tracing** | "Data enrichment" (invisible to users) | 5 (BatchLeads, DealMachine, PropStream, REsimpli, Pebble) | Add "Skip Trace" as the user-facing label for contact/owner lookups in the Leads UI |
| 2 | **CRM** | No single label (Leads + Deals + Inbox) | 7 (all except Harvey) | Add "CRM" as a meta-term in marketing and SEO. Consider sidebar group label "CRM" for Leads/Deals/Inbox |
| 3 | **Comps / Comparable Sales** | AVM | 4 (BatchLeads, DealMachine, PropStream, Pebble) | Add "Comps" as subtitle: "AVM (Comps)" or rename to "Comps / AVM" |
| 4 | **Motivated Sellers** | Leads (generic) | 4 (BatchLeads, DealMachine, PropStream, REsimpli) | Add as a named lead filter, tag, or list type in the Leads UI |
| 5 | **List Building** | (none) | 4 (BatchLeads, DealMachine, PropStream, REsimpli) | If AcreOS adds external data search, adopt "List Builder" as the feature name |
| 6 | **Property Data** | Properties | 5 (BatchLeads, DealMachine, PropStream, REsimpli, Pebble) | Add visible "Enrich" or "Property Data" action on property records |
| 7 | **KPI Dashboard** | Insights | 3 (InvestorFuse, REsimpli, Pebble) | Consider subtitle: "Insights (KPIs)" |
| 8 | **Cash Buyers** | Marketplace | 3 (BatchLeads, PropStream, REsimpli) | Add "Cash Buyers" as a section or filter within Marketplace |

---

## AcreOS-Only Terms (Not Found in Any Competitor)

These terms are unique differentiators. No competitor uses them, meaning they require education but also represent moats:

| AcreOS Term | Nav Location | Differentiation Value |
|---|---|---|
| Land Credit (300-850) | Intelligence > Land Credit | Proprietary scoring model for land parcels |
| AVM (AcreOS Valuation Model) | Intelligence > AVM | Automated valuation beyond simple comps |
| Blind Offer Wizard | Leads > Blind Offer Wizard | Land-specific mass-offer workflow |
| Acq. Radar | Intelligence > Acq. Radar | AI-scored acquisition opportunities |
| Doc Intel | Intelligence > Doc Intel | AI contract parsing and extraction |
| Capital Mkts | Finance > Capital Mkts | Note securitization and lender matching |
| Pax | AI Hub / notification badge | Named AI agent with proactive observations |
| Seller Financing / Notes | Finance | Built-in note portfolio management |
| Cash Flow (12-month forecasting) | Finance > Cash Flow | Forward-looking financial modeling |
| Compliance (Regulatory monitoring) | Intelligence > Compliance | Proactive regulatory watch |
| Counties (USDA + Census intelligence) | Intelligence > Counties | County-level market intelligence |
| Markets (Market Intelligence) | Intelligence > Markets | Market analysis and price trends |
