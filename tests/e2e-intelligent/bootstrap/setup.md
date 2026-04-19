# MCP Bootstrap Setup

Steps to prepare the environment for an AcreOS E2E intelligent test run.

## Prerequisites

- Claude Code CLI installed and authenticated.
- Node.js 20+ available on PATH.
- Access to the AcreOS staging or production environment.

## Steps

1. **Check for Playwright MCP server.** Run `npx @anthropic-ai/claude-code mcp list` and look for a Playwright entry. If no Playwright MCP server is registered, proceed to step 2. If it is already registered, skip to step 3.

2. **Install Playwright MCP.** Register the Playwright MCP server so Claude Code can control a browser:
   ```
   npx @anthropic-ai/claude-code mcp add playwright -- npx @anthropic-ai/playwright-mcp --headless
   ```
   Then install the Chromium browser binary:
   ```
   npx playwright install chromium
   ```

3. **Install harness dependencies.** From the `tests/e2e-intelligent` directory:
   ```
   npm install
   ```

4. **Verify configuration.** Confirm that `personas/`, `journeys/`, and `knowledge/` directories contain the expected config files. The assignment matrix in `assignments/` should map personas to journeys.

5. **End the current session.** MCP server registration requires a session restart to take effect. If you installed the Playwright MCP in step 2, end this Claude Code session and start a new one. The new session will have browser control available.

## Notes

- The `--headless` flag runs Chromium without a visible window. Remove it during local debugging to watch the browser.
- The harness creates its output under `artifacts/runs/<runId>/`. Ensure the `artifacts/` directory is gitignored if you do not want screenshots committed.
