# E2E Suite Adaptation Audit

## Files Preserved Unchanged
- `personas/` — all 12 persona files
- `knowledge/` — all 6 domain knowledge files (~15k words)
- `journeys/` — all 10 journey definition files
- `src/harness/` — all 8 TypeScript files (claude-agent, browser-controller, runner, transcript-writer, persona-loader, journey-loader, knowledge-loader, types)
- `package.json`, `tsconfig.json`, `.env.example`, `.gitignore`

## Files Added for Claude Code Execution
- `evaluators/` — 5 markdown rubrics mirroring src/evaluators/ logic
- `prompts/` — 3 session prompt templates (bootstrap, persona-run, cycle-report)
- `bootstrap/` — MCP setup and verification protocols
- `assignments/` — cycle-1 assignment matrix (36 runs across 12 personas)
- `CLAUDE.md` — directory guide for Claude Code sessions
- `TRANSCRIPT-FORMAT.md` — output schema for transcripts
- `FINDINGS-FORMAT.md` — output schema for findings
- `ADAPTATION-AUDIT.md` — this file

## Behaviors Translated from SDK to Session Prompts

| SDK Behavior (claude-agent.ts) | Claude Code Equivalent |
|-------------------------------|----------------------|
| `decideNextAction(observation)` | Observe via `browser_snapshot`, reason in character, execute via MCP |
| `evaluateAIOutput(output, context)` | Apply `evaluators/ai-output-rubric.md` manually at checkpoints |
| `reactToSurprise(surprise)` | In-character reaction written to transcript |
| `assessJourneyCompletion(trajectory)` | Apply `evaluators/aggregator-rubric.md` at journey end |
| Prompt caching (ephemeral blocks) | Context loaded once at session start (inherent in Claude Code) |
| Structured JSON output parsing | Markdown transcript (richer, same information) |
| Token usage tracking | Not needed — Max subscription, no per-token billing |

## What SDK Code Remains For
Future CI integration when revenue justifies API billing. Same persona/knowledge/journey files, same intellectual substance, programmatic execution.
