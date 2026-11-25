# The game server image: one image for every game (design D8, T9).
# Build from the repo root, so the workspace files and games/ are in context:
#   docker buildx build --platform linux/arm64 -f game-server/Dockerfile -t <tag> .
# (`just push-image` does this and pushes to ECR.)
ARG BASE=node:22-alpine

# Install production dependencies for the game-server workspace only.
FROM ${BASE} AS deps
WORKDIR /app
# npm ci checks the lockfile against every workspace's package.json, so all
# of them are needed, even though only game-server's dependencies get installed.
COPY package.json package-lock.json ./
COPY game-server/package.json game-server/
COPY games/starvethefox/package.json games/starvethefox/
COPY games/ur/package.json games/ur/
COPY lambdas/gameAPI/package.json lambdas/gameAPI/
RUN npm ci --omit=dev --workspace game-server --include-workspace-root=false \
    && npm cache clean --force

FROM ${BASE}
WORKDIR /app
ENV NODE_ENV=production PORT=8000
# Dependencies are hoisted to /app/node_modules, where both game-server/ and
# games/*/src/ find them by walking up.
COPY --from=deps /app/node_modules node_modules
COPY game-server/package.json game-server/
COPY game-server/src game-server/src
# Each game's package.json is needed for its "type": "module".
COPY games games

USER node
EXPOSE 8000
CMD ["node", "game-server/src/main.js"]
