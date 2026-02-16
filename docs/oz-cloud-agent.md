# Oz Cloud Agent (Autonomous PRs)

## What is a PR?
A **PR (pull request)** is a proposed change to the codebase that someone can review before it’s merged into `main`.

## How the cloud agent should work (high level)
The agent’s job is to make safe, small improvements by:
1) Creating a new branch (never working directly on `main`).
2) Committing changes on that branch.
3) Pushing the branch to GitHub.
4) Opening a PR for human review.
5) Iterating based on feedback until it’s ready to merge.

### Branch naming
Use this format so it’s easy to track agent work:
- `agent/YYYY-MM-DD/short-description`

Example:
- `agent/2026-02-16/fix-login-copy`

### Review loop (what you do)
1) Open the PR.
2) Read the summary (what changed + why).
3) Leave comments if you want edits.
4) The agent updates the branch and pushes again.
5) When you’re happy, you merge.

## Two environment types (NO-INSTALL vs INSTALL)
Cloud environments can be set up two ways. Pick based on what you want the agent to do.

### 1) NO-INSTALL environment (for docs/config-only PRs)
Use this when you only want changes like:
- documentation (`docs/**`, `*.md`)
- config files (`.gitignore`, `*.json`, `*.yml`, etc.)
- Warp agent files (`.warp/**`)

In a NO-INSTALL environment:
- The agent must **not** install dependencies.
- The agent must **not** claim to have run `npm run check`.
- The agent should only touch docs/config/text files.

This is the most reliable mode when installs are flaky.

How to create it (conceptually):
- Create an environment that checks out `Thmsnrtn/AcreOS`.
- Do **not** run `npm install` / `npm ci` in setup.
- Optional: provide read-only secrets if needed for docs tooling (usually none).

### 2) INSTALL environment (for code changes)
Use this when you want the agent to change application code.

In an INSTALL environment:
- The environment setup installs dependencies.
- The agent must run `npm run check` before pushing.

Important note:
- Dependency installs are currently **flaky** in cloud runs. That’s expected right now and we’ll fix it later.
- If installs fail, the agent should fall back to NO-INSTALL mode and limit itself to docs/config-only changes.

How to create it (conceptually):
- Create an environment that checks out `Thmsnrtn/AcreOS`.
- Add setup commands that run `npm ci` (or `npm install`).
- Ensure Node.js is available in the environment.

## Running the agent (copy/paste)
You run the cloud agent with:
- a **skill** (what the agent should do)
- an **environment ID** (where it runs)

### Run in NO-INSTALL environment (docs/config only)
Replace `ENV_ID_NO_INSTALL` with your environment id:

```bash
oz agent run-cloud \
  --skill Thmsnrtn/AcreOS:acreos-autonomous-engineer \
  --environment ENV_ID_NO_INSTALL \
  -- "Update docs/config only. Do not install dependencies."
```

### Run in INSTALL environment (code changes)
Replace `ENV_ID_INSTALL` with your environment id:

```bash
oz agent run-cloud \
  --skill Thmsnrtn/AcreOS:acreos-autonomous-engineer \
  --environment ENV_ID_INSTALL \
  -- "Make a small code change and run npm run check before pushing."
```

## What to expect from outputs
A successful run should produce:
- A pushed branch named like `agent/YYYY-MM-DD/...`
- A PR opened against `main`
- A short founder-friendly summary of what changed and why

If something fails (install, push auth, etc.), the run output should show the exact error so you can diagnose it.
