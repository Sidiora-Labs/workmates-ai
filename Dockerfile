FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@10
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY server ./server
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN pnpm build:cloud && pnpm build:web

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 curl openssh-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist ./dist
COPY package.json LICENSE ./
LABEL org.opencontainers.image.title="Workmates" \
      org.opencontainers.image.description="Personal AI agents with a shared cloud workspace, desktop and mobile access" \
      org.opencontainers.image.source="https://github.com/Sidiora-Labs/workmates-ai" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production \
    WORKMATES_HOSTED=1 \
    WORKMATES_DATA_DIR=/data/workspace \
    WORKMATES_STATIC_DIR=/app/dist \
    PORT=8080
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
