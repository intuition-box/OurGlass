# ---- Build stage ----
FROM oven/bun:1 AS build
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

# ---- Serve stage ----
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
