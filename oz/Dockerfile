# AcreOS Oz Agent Environment
FROM node:20.18.1-bullseye

# --no-install-recommends keeps the surface minimal (Trivy DS-0029);
# upgrade pulls Debian security patches newer than the base image tag.
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install --no-install-recommends -y git jq curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# Cache deps if package manifests exist
COPY package.json package-lock.json ./
RUN if [ -f package.json ]; then npm ci; fi

# Tools commonly used in this repo
RUN npm i -g typescript tsx eslint

# Agent sessions run as the unprivileged node user (Trivy DS-0002). The
# workspace must stay writable for in-container builds/edits.
RUN chown -R node:node /workspace
USER node

CMD ["bash", "-lc", "sleep infinity"]
