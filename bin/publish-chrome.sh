#!/bin/sh
set -e

EXTENSION_ID="iehoehfkanaobnbldjfjfabbpaiiojnp"
API_URL="https://www.googleapis.com"

usage() {
  echo "Usage: $0 [--draft] [--token REFRESH_TOKEN] [--client-id ID] [--client-secret SECRET]"
  echo ""
  echo "Environment variables (override flags):"
  echo "  CHROME_REFRESH_TOKEN   OAuth2 refresh token"
  echo "  CHROME_CLIENT_ID       OAuth2 client ID"
  echo "  CHROME_CLIENT_SECRET   OAuth2 client secret"
  echo ""
  echo "Options:"
  echo "  --draft      Upload only, do not submit for review (default: publish)"
  echo "  --zip FILE   Upload existing ZIP instead of building from git"
  exit 1
}

PUBLISH=true
ZIP_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --draft) PUBLISH=false; shift ;;
    --token) CHROME_REFRESH_TOKEN="$2"; shift 2 ;;
    --client-id) CHROME_CLIENT_ID="$2"; shift 2 ;;
    --client-secret) CHROME_CLIENT_SECRET="$2"; shift 2 ;;
    --zip) ZIP_FILE="$2"; shift 2 ;;
    *) usage ;;
  esac
done

: "${CHROME_REFRESH_TOKEN:?Set CHROME_REFRESH_TOKEN (or pass --token)}"
: "${CHROME_CLIENT_ID:?Set CHROME_CLIENT_ID (or pass --client-id)}"
: "${CHROME_CLIENT_SECRET:?Set CHROME_CLIENT_SECRET (or pass --client-secret)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$ZIP_FILE" ]; then
  ZIP_FILE="/tmp/vizonator-$(date +%Y%m%d%H%M%S).zip"
  echo "Building ZIP..."
  "$SCRIPT_DIR/build-zip.sh" "$ZIP_FILE"
fi

echo "Getting access token..."
ACCESS_RESP=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
  -d "client_id=$CHROME_CLIENT_ID" \
  -d "client_secret=$CHROME_CLIENT_SECRET" \
  -d "refresh_token=$CHROME_REFRESH_TOKEN" \
  -d "grant_type=refresh_token")

ACCESS_TOKEN=$(echo "$ACCESS_RESP" | grep -o '"access_token"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | cut -d'"' -f2)
: "${ACCESS_TOKEN:?Failed to get access token: $ACCESS_RESP}"

echo "Uploading to Chrome Web Store..."
UPLOAD_RESP=$(curl -s -X PUT \
  "${API_URL}/upload/chromewebstore/v1.1/items/${EXTENSION_ID}?uploadType=media" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "x-goog-api-version: 1.1" \
  -H "Content-Type: application/zip" \
  --data-binary "@${ZIP_FILE}")

UPLOAD_STATUS=$(echo "$UPLOAD_RESP" | grep -o '"uploadState"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | cut -d'"' -f2)
echo "Upload state: ${UPLOAD_STATUS:-unknown}"

if [ "$UPLOAD_STATUS" != "SUCCESS" ] && [ "$UPLOAD_STATUS" != "IN_PROGRESS" ]; then
  echo "Upload failed: $UPLOAD_RESP"
  exit 1
fi

if [ "$PUBLISH" = true ]; then
  echo "Publishing..."
  PUBLISH_RESP=$(curl -s -X POST \
    "${API_URL}/chromewebstore/v1.1/items/${EXTENSION_ID}/publish?publishTarget=default" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "x-goog-api-version: 1.1" \
    -H "Content-Length: 0")
  PUB_STATUS=$(echo "$PUBLISH_RESP" | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | cut -d'"' -f2)
  echo "Publish status: ${PUB_STATUS:-unknown}"
  if [ "$PUB_STATUS" != "OK" ]; then
    echo "Publish response: $PUBLISH_RESP"
    exit 1
  fi
  echo "Submitted for review (public release)."
else
  echo "Uploaded as draft. Run without --draft to submit for review."
fi

echo "Done. Review at: https://chrome.google.com/webstore/developer/edit/${EXTENSION_ID}"
