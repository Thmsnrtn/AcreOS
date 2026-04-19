# Pre-Flight Verification

Run these checks before starting an E2E intelligent test session. All must pass.

## Checklist

1. **MCP available.** Confirm the Playwright MCP server is registered and responding. Run `npx @anthropic-ai/claude-code mcp list` and verify the `playwright` entry appears. If missing, follow `bootstrap/setup.md`.

2. **AcreOS accessible.** Open the target environment URL (staging or production) in a browser or via `curl` and confirm a 200 response. The harness will use the `startUrl` from each journey config, so verify that base URL is reachable.

3. **Assignment matrix checked.** Read the assignment matrix in `assignments/` to confirm which persona-journey pairs are scheduled for this session. Do not run pairs that have already been completed unless a re-run is intentional.

4. **Previous session committed.** If a prior test session produced artifacts (transcripts, findings, screenshots), ensure those results have been committed or archived before starting a new run. The harness does not overwrite existing run directories but stale uncommitted artifacts create confusion.

## If Any Check Fails

Do not proceed with the test run. Resolve the issue first. The most common failure is a missing Playwright MCP registration, which requires running the setup steps in `bootstrap/setup.md` and restarting the session.
