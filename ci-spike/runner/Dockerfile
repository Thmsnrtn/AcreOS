# Custom runner image for the Fly CI rollout (not built during the spike —
# the spike ran GitHub's official published agent image,
# ghcr.io/actions/actions-runner, which is the same actions/runner agent on
# Ubuntu 24.04; this Dockerfile is the versioned starting point for a
# toolchain-complete image with node 20+, build tools and the repo's CI
# prerequisites baked in).
FROM ubuntu:24.04

ARG RUNNER_VERSION=2.330.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash curl git jq ca-certificates libicu74 libssl3 \
      build-essential python3 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/runner/actions-runner \
    && curl -fsSL -o /tmp/runner.tar.gz \
       "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && tar -xzf /tmp/runner.tar.gz -C /home/runner/actions-runner \
    && rm /tmp/runner.tar.gz

# Run the agent as a non-root user: the self-hosted runner's supported mode
# (it writes its config, logs and _work dir under its own home), and Trivy
# DS-0002 requires at least one non-root USER in every Dockerfile. The user
# is created after the root-only install/extract steps and owns the whole
# runner home, so no root-only step follows it. RUNNER_ALLOW_RUNASROOT is
# dropped with it: it only matters when the agent runs as root, which this
# image no longer does. (controller.mjs still passes it for the spike's
# published-image JIT runs — a separate path, untouched here.)
RUN useradd -d /home/runner -s /bin/bash runner \
    && chown -R runner:runner /home/runner

WORKDIR /home/runner/actions-runner

USER runner

# JIT config arrives via the JITCONFIG env var (single-use bearer credential;
# never baked into the image, never logged). Exactly one job runs, then the
# process exits and the Fly Machine (auto_destroy) is destroyed.
ENTRYPOINT ["/bin/bash", "-c", "exec ./run.sh --jitconfig \"$JITCONFIG\""]
