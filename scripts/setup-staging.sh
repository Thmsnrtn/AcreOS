#!/usr/bin/env bash
#
# One-shot staging provisioning for realism-mode audits.
# Run this in YOUR terminal (where you're authenticated to Fly + GitHub).
# It contains NO secret values — it reads them from a local, gitignored
# `.env.staging` file that you fill in from `.env.staging.example`.
#
#   1. cp .env.staging.example .env.staging   &&   fill in the real TEST-MODE values
#   2. fly auth login   &&   gh auth login   (if not already)
#   3. bash scripts/setup-staging.sh
#
# The ordering is deliberate: the Fly app + secrets are created BEFORE the
# `FLY_STAGING_APP` GitHub variable is set, because that variable un-gates the
# dormant staging-deploy + realism-audit workflows — setting it before the app
# exists would turn CI red. See tests/README-realism-mode.md.
set -euo pipefail

APP="${FLY_STAGING_APP:-acreos-staging}"
DB="${APP}-db"
ENV_FILE=".env.staging"

say() { printf "\n\033[1m▶ %s\033[0m\n" "$*"; }
die() { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# ── Preconditions ──────────────────────────────────────────────────────────
command -v flyctl >/dev/null || die "flyctl not installed (https://fly.io/docs/flyctl/install)"
command -v gh >/dev/null     || die "gh CLI not installed"
flyctl auth whoami >/dev/null 2>&1 || die "not logged in to Fly — run: fly auth login"
gh auth status >/dev/null 2>&1     || die "not logged in to GitHub — run: gh auth login"
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE — run: cp .env.staging.example $ENV_FILE  then fill it in"

# Refuse to proceed if any value is still a placeholder (…) from the template.
if grep -qE "=…|=$|sk_test_…|pk_test_…|test_…" "$ENV_FILE"; then
  die "$ENV_FILE still has placeholder values (…). Fill in the real TEST-MODE keys first."
fi

# ── 1. App + Postgres (idempotent) ─────────────────────────────────────────
say "Creating Fly app '$APP' (skips if it exists)"
flyctl apps create "$APP" 2>/dev/null || echo "  app '$APP' already exists — continuing"

say "Creating + attaching staging Postgres '$DB' (skips if it exists)"
if ! flyctl postgres list 2>/dev/null | grep -q "$DB"; then
  flyctl postgres create --name "$DB" --region iad --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
  flyctl postgres attach "$DB" --app "$APP"
else
  echo "  postgres '$DB' already exists — continuing"
fi

# ── 2. Fly secrets from .env.staging (values never leave your machine) ──────
say "Pushing test-mode secrets to '$APP' from $ENV_FILE"
# Build KEY=VALUE args from the file, skipping comments/blanks and DATABASE_URL
# (Postgres attach already set it).
SECRET_ARGS=()
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  key="${line%%=*}"
  [[ "$key" == "DATABASE_URL" ]] && continue
  SECRET_ARGS+=("$line")
done < "$ENV_FILE"
[ ${#SECRET_ARGS[@]} -gt 0 ] && flyctl secrets set -a "$APP" "${SECRET_ARGS[@]}"

# ── 3. GitHub secrets for the audit's authed + DB layers (interactive) ──────
say "GitHub secrets for realism-audit.yml (gh prompts — values stay hidden)"
echo "  Paste a Clerk TEST sign-in ticket when prompted:"
gh secret set CLERK_SIGN_IN_TICKET || echo "  (skipped — set later to enable the authed layer)"
echo "  Paste the staging DB connection string when prompted:"
gh secret set DATABASE_URL_STAGING || echo "  (skipped — set later to enable IDOR/load layers)"

# ── 4. THE FLIP — un-gate the dormant workflows (must be last) ──────────────
say "Setting FLY_STAGING_APP='$APP' (wakes staging-deploy + realism-audit)"
gh variable set FLY_STAGING_APP --body "$APP"

say "Done. The next push to main deploys staging and runs the realism audit."
echo "  Watch:  gh run watch \$(gh run list --workflow='Deploy to Staging' --limit 1 --json databaseId --jq '.[0].databaseId')"
