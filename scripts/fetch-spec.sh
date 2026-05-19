#!/usr/bin/env bash
# Fetch the latest OpenAPI spec from the live game server and write it to ./openapi.json
# Override the URL with SPACEMOLT_OPENAPI_URL.

set -euo pipefail

URL="${SPACEMOLT_OPENAPI_URL:-https://game.spacemolt.com/api/v2/openapi.json}"
OUT="$(dirname "$0")/../openapi.json"

echo "Fetching $URL"
curl --fail --silent --show-error "$URL" -o "$OUT"
echo "Wrote $OUT"
