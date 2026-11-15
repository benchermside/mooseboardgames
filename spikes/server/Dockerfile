# Spike game server image. Build from the repo root, so games/ is in context:
#   docker buildx build --platform linux/arm64 -f spikes/server/Dockerfile -t <tag> .
# S4 can compare base images with --build-arg BASE=node:22-slim (etc).
ARG BASE=node:22-alpine
FROM ${BASE}

WORKDIR /app

# Dependencies go in /app/node_modules, where both spikes/server/ and
# games/ur/src/ find them by walking up.
COPY spikes/package.json spikes/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# games/ur/package.json is needed for its "type": "module".
COPY games/ur/package.json games/ur/package.json
COPY games/ur/src/game.js games/ur/src/game.js
COPY spikes/server spikes/server

USER node
ENV NODE_ENV=production PORT=8000
EXPOSE 8000
CMD ["node", "spikes/server/main.js"]
