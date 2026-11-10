FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm ci --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production
USER node
# Optional: -e AGENTXRAY_TOKEN=axr_... ; without it the catalog is listed and tools return setup steps.
ENTRYPOINT ["node", "dist/index.js"]
