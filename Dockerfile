# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json NOTICE ./
COPY schema ./schema
COPY template ./template
COPY examples ./examples

# Run as the unprivileged "node" user that ships with the base image.
USER node

# Mount your knowledge at /data/content (read-only is recommended) and give the
# server a writable place for proposals at /data/proposals.
ENV POCKET_CONTENT_DIR=/data/content \
    POCKET_PROPOSALS_DIR=/data/proposals

# MCP over stdio: run with `docker run -i --rm ...` from your MCP client.
ENTRYPOINT ["node", "dist/server.js"]
