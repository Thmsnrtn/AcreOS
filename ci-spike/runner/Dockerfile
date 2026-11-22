# Custom runner image for the Fly CI rollout (rollout build, 2026-11-22 —
# supersedes the spike-era draft of this file, which was never built).
#
# Design constraints that shape this image:
# - The controller (ci-spike/controller.mjs) spawns the machine with
#   entrypoint `cd /home/runner && exec ./run.sh --jitconfig "$JITCONFIG"`,
#   so the agent is installed directly in /home/runner (no subdir).
# - A Fly Machine has no Docker daemon, so GitHub `services:` containers
#   cannot run on these runners. The test shards need a live pgvector
#   PostgreSQL, so PostgreSQL 16 + pgvector are baked into the image and
#   the job starts the cluster itself (see the probe/test-fly job steps);
#   the cluster data dir is pre-initialized at build time, owned by the
#   runner user, with the same role/database the hosted services block
#   provisions (acreos / acreos_test) plus the vector extension.
# - No repo secrets, no deploy tokens: the only credential a runner ever
#   holds is its single-use JIT config, delivered via env at machine
#   creation. The database password below is the public CI test password
#   already printed in .github/workflows/test.yml.
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.330.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl git jq ca-certificates libicu74 libssl3 \
      build-essential python3 unzip gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# PostgreSQL 16 server + pgvector + client tools from the PostgreSQL
# project's own apt repository (PGDG) — Ubuntu 24.04's stock repos carry
# neither the pg16 server set this repo's schema gate pins nor pgvector.
RUN install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends \
       postgresql-16 postgresql-16-pgvector postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/runner \
    && curl -fsSL -o /tmp/runner.tar.gz \
       "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && tar -xzf /tmp/runner.tar.gz -C /home/runner \
    && rm /tmp/runner.tar.gz

# Run the agent as a non-root user: the self-hosted runner's supported mode
# (it writes its config, logs and _work dir under its own home), and Trivy
# DS-0002 requires at least one non-root USER in every Dockerfile.
RUN useradd -d /home/runner -s /bin/bash runner \
    && mkdir -p /home/runner/pgdata /home/runner/pglog \
    && chown -R runner:runner /home/runner

# Pre-initialize the test cluster as the runner user: role + database +
# pgvector extension exist before any job starts; the job only starts the
# server (pg_ctl, no root, no systemd). initdb's default local auth is
# trust on this throwaway single-job machine; the role still carries the
# public CI password so the workflow's DATABASE_URL works verbatim.
USER runner
RUN /usr/lib/postgresql/16/bin/initdb -D /home/runner/pgdata -E UTF8 --locale=C.UTF-8 \
    && /usr/lib/postgresql/16/bin/pg_ctl -D /home/runner/pgdata -l /home/runner/pglog/init.log -w start \
    && psql -h localhost -U runner -d postgres \
       -c "CREATE ROLE acreos LOGIN PASSWORD 'acreos' SUPERUSER" \
    && psql -h localhost -U runner -d postgres \
       -c "CREATE DATABASE acreos_test OWNER acreos" \
    && psql -h localhost -U runner -d acreos_test \
       -c "CREATE EXTENSION vector" \
    && /usr/lib/postgresql/16/bin/pg_ctl -D /home/runner/pgdata -w stop

WORKDIR /home/runner

# JIT config arrives via the JITCONFIG env var (single-use bearer <redacted>;
# never baked into the image, never logged). Exactly one job runs, then the
# process exits and the Fly Machine (auto_destroy) is destroyed. The
# controller overrides entrypoint/cmd with the identical command.
ENTRYPOINT ["/bin/bash", "-c", "exec ./run.sh --jitconfig \"$JITCONFIG\""]
