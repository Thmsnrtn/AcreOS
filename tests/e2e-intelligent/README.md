# AcreOS Intelligent E2E Test Harness

Claude-in-the-loop end-to-end testing. Each test simulates a real land investor using AcreOS — Claude makes every decision, evaluates every output, and judges quality with domain expertise.

## Quick Start

```bash
cd tests/e2e-intelligent
npm install
npx playwright install chromium
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY and ACREOS_BASE_URL
```

## Run Modes

```bash
# Single persona × single journey (debug, headed browser)
npm run e2e:single -- --persona 01-new-to-land-suburban --journey 01-first-deal-evaluation

# Subset (3 personas × their assigned journeys)
npm run e2e:subset -- --personas 01,05,11

# Full cycle (all 12 personas × assigned journeys, headless)
npm run e2e:cycle
```

## How It Works

1. **Persona loaded** — Claude reads a full persona file (demographics, backstory, investment thesis, abandonment triggers)
2. **Knowledge injected** — 6 domain knowledge files (~15K words) on land investing fundamentals, regional variations, workflows, AI red flags, competitors, and AcreOS's product model
3. **Journey assigned** — goal, success criteria, common failure modes
4. **Decision loop** — at each step, Claude sees a screenshot + metadata, decides what the persona would do next, Playwright executes, repeat
5. **Quality evaluation** — when AI output appears (Atlas analysis, Pax recommendation), Claude evaluates credibility against domain knowledge
6. **Transcript produced** — per-step reasoning, in-character thoughts, screenshots, findings

## Three Evaluation Layers

- **Structural** — clicks work, pages load, no 500s
- **Workflow** — persona accomplishes their goal (or abandons for a real reason)
- **Quality** — AI outputs are credible, domain-accurate, appropriately cautious

## Personas (12)

| # | Name | Type | Key Trait |
|---|------|------|-----------|
| 01 | Marcus Reid | New to land | First-time, needs "aha" in 5 min |
| 02 | Dana Cho | Wholesaler | 40+ deals/yr, skeptical of AI |
| 03 | Robert Maple | Buy & hold | 30+ parcels, methodical |
| 04 | Priya Shah | Tax delinquent | Analytical, cross-references data |
| 05 | James Folkes | Note investor | Seller finance, math accuracy |
| 06 | Ty Holcomb | Raw land flipper | Speed-obsessed, Land Academy |
| 07 | Sofia Martinelli | International | Cross-border, USD/CAD |
| 08 | Eleanor Briggs | Retiree | Phone-only, low tech |
| 09 | Wyatt Kessler | Scale operator | 3→10 deals/mo |
| 10 | Tasha Okonkwo | Mobile D4D | Phone-only, field use |
| 11 | Gabriel Ross | AI skeptic | Will probe for hallucinations |
| 12 | Ingrid Valensen | Data analyst | Wants charts, exports, SQL |

## Journeys (10)

| # | Journey | Core Test |
|---|---------|-----------|
| 01 | First Deal Evaluation | Parcel → analysis → decision |
| 02 | Mail Campaign | County → list → campaign → send |
| 03 | Distressed Parcel | Tax-delinquent deep dive |
| 04 | Note Servicing | Seller finance setup |
| 05 | Portfolio Import | CSV import 50+ parcels |
| 06 | Skip Trace | Find owner → outreach |
| 07 | Pax Strategy | AI copilot Q&A |
| 08 | Decision Review | Autonomous decision approve/reject |
| 09 | Pipeline Dealflow | Move deal through stages |
| 10 | Billing Change | Upgrade tier |

## Output

Artifacts go to `artifacts/` (gitignored):
- `artifacts/runs/<run-id>/transcript.md` — full step-by-step transcript
- `artifacts/runs/<run-id>/screenshots/` — per-step screenshots
- `artifacts/runs/<run-id>/claude-reasoning.jsonl` — decision log
- `artifacts/reports/<cycle-id>.json` — cycle summary

## Cost Estimate

Per persona-journey run: ~300-500K tokens (mostly screenshots). With prompt caching: ~$2-5 per run. Full 12-persona cycle: ~$30-60.

## Extending

**Add a persona:** Create `personas/13-your-persona.md` with YAML frontmatter + narrative.
**Add a journey:** Create `journeys/11-your-journey.md` with YAML frontmatter + context.
**Add knowledge:** Drop a `.md` file in `knowledge/` — it's auto-loaded.
