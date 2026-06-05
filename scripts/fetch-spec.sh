#!/usr/bin/env bash
# Fetch the latest OpenAPI spec from the live game server and update ./openapi.json.
# Writes to a staging file first and verifies it's a valid spec (not an error or
# rate-limit response) before overwriting. Override the URL with SPACEMOLT_OPENAPI_URL.
#
# If you hit a rate limit (usually caused by fetching repeatedly in quick
# succession), wait ~35s and try again.

set -euo pipefail

URL="${SPACEMOLT_OPENAPI_URL:-https://game.spacemolt.com/api/v2/openapi.json}"
DIR="$(dirname "$0")/.."
STAGING="$DIR/openapi.staging.json"
TARGET="$DIR/openapi.json"

trap 'rm -f "$STAGING"' EXIT

echo "Fetching $URL"
# The spec endpoint rate-limits consecutive fetches (~35s window) with a 429.
# curl treats 429 (and 408/5xx) as transient when --retry is set, so back off
# and retry instead of failing — e.g. when a version probe just hit the URL.
curl --fail --silent --show-error --retry 4 --retry-delay 40 "$URL" -o "$STAGING"

# Verify it's actually a spec and not an error/rate-limit response.
VERSION=$(STAGING="$STAGING" bun -e "
  const spec = JSON.parse(await Bun.file(process.env.STAGING).text());
  if (spec.error) {
    console.error('Server returned an error: ' + (spec.message ?? spec.error));
    process.exit(1);
  }
  if (!spec.info?.version || !spec.paths) {
    console.error('Response does not look like an OpenAPI spec.');
    process.exit(1);
  }
  console.log(spec.info.version);
")

mv "$STAGING" "$TARGET"
echo "Updated $TARGET to spec version $VERSION"
