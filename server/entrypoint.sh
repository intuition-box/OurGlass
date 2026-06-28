#!/bin/sh
# Run the Intuition publisher (bun) in the background and Caddy in the foreground.
# If the publisher exits (e.g. INTUITION_ATTESTOR_PK unset), Caddy keeps serving
# the static apps — auto-publish degrades, the site stays up.
set -e

( cd /publisher && bun server/intuition-publisher.ts ) &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
