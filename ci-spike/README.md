# Fly CI spike

Proof-of-concept (2026-11-19): one GitHub Actions job executed end-to-end on
an ephemeral Fly.io Machine acting as a just-in-time (JIT) self-hosted runner
for this repo.

## Pieces

- `.github/workflows/fly-ci-spike.yml` — throwaway `workflow_dispatch`-only
  workflow; its one job targets the dedicated `fly-ci-spike` label.
- `ci-spike/controller.mjs` — zero-dependency Node service (Fly app
  `acreos-ci-controller`, https://acreos-ci-controller.fly.dev). Receives the
  repo's `workflow_job` webhook, verifies the HMAC signature, applies the
  guards (repo match, spike label, spike workflow, head-repo/fork check), and
  spawns one ephemeral runner Machine (Fly app `acreos-ci-runner`) per queued
  job. A reaper destroys any spike machine older than 60 minutes.
- `ci-spike/runner/Dockerfile` — custom runner image for rollout. The spike
  itself ran GitHub's official published agent image
  (`ghcr.io/actions/actions-runner:latest`), the same actions/runner agent on
  Ubuntu 24.04.

## Safety rails

- Runner machines are ephemeral: JIT runners take exactly one job and exit;
  machines are created with `auto_destroy` and `restart: no`; the reaper is
  the backstop for orphans.
- The runner image and machine config carry no repo secrets and no deploy
  tokens. The only credential on a runner machine is its single-use JIT
  config, delivered via env at creation and never logged.
- The controller only spawns for jobs carrying the `fly-ci-spike` label in
  the `Fly CI Spike` workflow, and only when the run's head repository is
  this repository (fork PRs can never spawn a machine).
- Webhook payloads are HMAC-verified before any action is taken.

## Credential state

The controller is code-complete but credential-gated. To make it fully
autonomous, provision as Fly secrets on `acreos-ci-controller`:

- `GH_JIT_TOKEN` — a fine-grained PAT scoped to this repo only with the
  **Administration** permission (required for `generate-jitconfig`), or a
  GitHub App installation token with the same scope.
- `FLY_API_TOKEN` — a Fly token able to create/destroy machines in the
  `acreos-ci-runner` app (e.g. an app-scoped deploy token for that app).

`GITHUB_WEBHOOK_SECRET` is already provisioned (it is also the secret on the
repo's `workflow_job` webhook).

## Spike lessons (measured, 2026-11-19)

- JIT runners advertise **exactly** the labels in the generated config — the
  system labels (`self-hosted`, `Linux`, `X64`) must be requested explicitly,
  or a job requiring `self-hosted` will never match the runner.
- In GitHub's official `actions-runner` image the agent lives in
  `/home/runner` (run.sh is at `/home/runner/run.sh`), not in an
  `actions-runner` subdirectory.
