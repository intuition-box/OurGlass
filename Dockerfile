# ---- Safe App build (Vite) ----
FROM oven/bun:1 AS app
WORKDIR /app

COPY package.json .npmrc ./
# bun.lock is gitignored, so don't require a frozen lockfile here.
RUN bun install

COPY . .

# Vite inlines VITE_* at build time, so the values must be present NOW.
# In Coolify set these as Build-time variables / build args — define them at the
# project level so every deployment, including each PR preview, inherits them.
ARG VITE_PINATA_JWT
ENV VITE_PINATA_JWT=$VITE_PINATA_JWT
# URL of the Intuition publisher backend (one shared backend serves all previews).
ARG VITE_INTUITION_PUBLISHER_URL
ENV VITE_INTUITION_PUBLISHER_URL=$VITE_INTUITION_PUBLISHER_URL
ARG VITE_INTUITION_PUBLISHER_SECRET
ENV VITE_INTUITION_PUBLISHER_SECRET=$VITE_INTUITION_PUBLISHER_SECRET
RUN bun run build
# -> /app/dist (asset URLs prefixed with /safe-app/)

# ---- Website build (Fumadocs, Next static export) ----
FROM node:22-alpine AS site
WORKDIR /site

COPY website/package.json website/package-lock.json ./
# Skip the fumadocs-mdx postinstall here: the source config isn't copied yet, and
# `next build` regenerates the MDX collections anyway via the createMDX plugin.
RUN npm ci --ignore-scripts

COPY website/ ./
RUN npm run build
# -> /site/out

# ---- Serve stage ----
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
# Website at the root; the Safe App SPA under /safe-app.
COPY --from=site /site/out /srv
COPY --from=app /app/dist /srv/safe-app
EXPOSE 80
