# AcreOS Intelligent E2E Test Suite

Intelligent end-to-end testing with Claude embodying land-investor personas, driving the browser, evaluating AI outputs with domain expertise.

## Two Execution Modes

### 1. Claude Code Sessions (PRIMARY — pre-launch)

Runs on operator's Max subscription. No API billing. One persona per session.

**One-time setup:**
```
# Start a fresh Claude Code session in the AcreOS repo
# Paste: tests/e2e-intelligent/prompts/session-0-bootstrap.md
# Let it install Playwright MCP
# End that session, start a fresh one
```

**Running a persona:**
```
# Start fresh Claude Code session in the AcreOS repo
# Pick next unrun persona-journey from assignments/cycle-1.md
# Fill in {{PERSONA_ID}}, {{JOURNEY_ID}}, {{RUN_ID}} in:
#   tests/e2e-intelligent/prompts/session-persona-run.md
# Paste into Claude Code
# Session runs 20-60 min autonomously, produces transcript + findings
```

**Running cycle report (after all assigned personas complete):**
```
# Start fresh Claude Code session
# Paste: tests/e2e-intelligent/prompts/session-cycle-report.md
```

### 2. SDK Harness (FUTURE — requires API billing)

Code in `src/harness/` provides a programmatic execution path. Reads the same persona/knowledge/journey files, produces the same transcript format.

```bash
cd tests/e2e-intelligent
npm install && npx playwright install chromium
cp .env.example .env  # Set ANTHROPIC_API_KEY
npm run e2e:single -- --persona 01-new-to-land-suburban --journey 01-first-deal-evaluation
```

## What the Suite Tests

- **Structural** — clicks work, pages load, no 500s, no console errors
- **Workflow** — persona accomplishes (or legitimately abandons) their journey goal
- **Quality** — AI outputs evaluated against land-investor domain expertise (5 dimensions, 15 credible/non-credible examples)
- **UX Coherence** — is what's on screen consistent with what was promised?

## The Suite

| Component | Count | Location |
|-----------|-------|----------|
| Personas | 12 | `personas/` |
| Journeys | 10 | `journeys/` |
| Knowledge files | 6 (~15k words) | `knowledge/` |
| Evaluator rubrics | 5 | `evaluators/` |
| Cycle 1 assignments | 36 runs | `assignments/cycle-1.md` |

## Output

- Per-run: `runs/<run-id>/transcript.md` + `findings.md`
- Cycle reports: `reports/<cycle-id>-report.md`
- Findings registry: `reports/findings-registry.md`

## Extending

- New persona: create `personas/13-your-persona.md` (see existing for format)
- New journey: create `journeys/11-your-journey.md`
- New knowledge: drop a `.md` in `knowledge/` — auto-loaded
- New cycle: create `assignments/cycle-N.md`
