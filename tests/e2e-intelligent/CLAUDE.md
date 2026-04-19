# AcreOS Intelligent E2E Test Suite

This directory contains the intelligent E2E test suite for AcreOS.

## Two execution modes

### Primary: Claude Code sessions (pre-launch, runs on Max subscription)
Operators paste `prompts/session-persona-run.md` filled in with persona and journey IDs. Claude Code reads persona + knowledge + journey + rubric files, drives the browser via Playwright MCP, produces transcripts and findings.

Required: Playwright MCP installed (see `bootstrap/setup.md`).

### Secondary: SDK harness (future CI use, requires API billing)
The `src/harness/` code is a parallel SDK-based harness for when revenue justifies API billing. It reads the same persona/knowledge/journey files and produces the same transcript format.

## When you (Claude Code) are running a persona session:

- ALWAYS read ALL context files listed in the session prompt before any browser action
- ALWAYS use Playwright MCP tools (browser_navigate, browser_click, browser_type, browser_snapshot, browser_close)
- ALWAYS stay in persona character throughout the run
- NEVER fix bugs encountered — findings.md only
- NEVER skip AI output evaluations — every Atlas/Pax/Sophie output gets scored with the full rubric
- NEVER modify product code
- ALWAYS commit checkpoints every 20 steps with [e2e-intelligent] tag
- ALWAYS write transcript in first-person persona voice, not narrator voice

## When you (Claude Code) are running a cycle report session:

- Read all transcripts and findings in `runs/` from the current cycle
- Deduplicate findings aggressively by root cause
- Produce the aggregate summary and founder letter
- Update the persistent findings registry

## File ownership

- `personas/` — 12 persona definitions, edit deliberately
- `knowledge/` — 6 domain knowledge files (~15k words), evolve based on calibration
- `journeys/` — 10 journey definitions, edit deliberately
- `evaluators/` — rubrics for scoring (markdown for Claude Code, mirrored in src/ for SDK)
- `runs/` — output artifacts from persona sessions, append-only
- `reports/` — aggregate output from cycle report sessions
- `src/` — SDK harness code, preserved for future CI use
- `prompts/` — session prompt templates
- `bootstrap/` — MCP installation and verification
- `assignments/` — cycle assignment matrices
