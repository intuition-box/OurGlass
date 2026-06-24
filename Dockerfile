# ---- Safe App build (Vite) ----
FROM oven/bun:1 AS app
WORKDIR /app

COPY package.json .npmrc ./
# bun.lock is gitignored, so don't require a frozen lockfile here.
RUN bun install

COPY . .

# Vite inlines VITE_* at build time, so the value must be present NOW.
# In Coolify set this as a Build-time variable / build arg.
ARG VITE_PINATA_JWT
ENV VITE_PINATA_JWT=$VITE_PINATA_JWT
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
