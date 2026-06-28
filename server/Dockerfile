# ---- Intuition publisher backend ----
# Long-running node service that holds the attestor key and writes signed
# delegations onto the Intuition graph. Deploy as a SEPARATE Coolify service
# (not the static Safe App). Build context = repo root (it imports src/lib).
FROM oven/bun:1
WORKDIR /app

COPY package.json .npmrc ./
# bun.lock is gitignored, so don't require a frozen lockfile.
RUN bun install

COPY . .

# Own port var so a platform-injected PORT doesn't repoint the listener.
ENV INTUITION_PUBLISHER_PORT=8787
EXPOSE 8787
CMD ["bun", "server/intuition-publisher.ts"]
