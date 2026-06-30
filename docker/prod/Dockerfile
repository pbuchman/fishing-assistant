FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV FA_PROD_ENV_FILE=/etc/fa/.env.prod

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig*.json ./
COPY ecosystem.config.prod.cjs ecosystem.generated.cjs ./
COPY firebase.json firestore-collections.json firestore.indexes.json firestore.rules ./

RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm run build:services \
  && for service in chat-service knowledge-service llm-usage-service user-service; do \
    cd "/app/apps/${service}/dist" \
    && npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false \
    && cd /app; \
  done

EXPOSE 3201 3202 3203 3204

# run-services-container.mjs renders ecosystem.config.prod.cjs to a private
# JSON file, then starts pm2-runtime with that rendered config.
CMD ["node", "scripts/hetzner/run-services-container.mjs"]
