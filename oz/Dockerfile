# AcreOS Oz Agent Environment
FROM node:20-bullseye

RUN apt-get update && apt-get install -y git jq curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace

# Cache deps if package manifests exist
COPY package.json package-lock.json ./
RUN if [ -f package.json ]; then npm ci; fi

# Tools commonly used in this repo
RUN npm i -g typescript tsx eslint

CMD ["bash", "-lc", "sleep infinity"]
