#!/bin/sh
set -e

ADDON_SLUG="vizonator"
AMO_API="https://addons.mozilla.org/api/v5"

usage() {
  echo "Usage: $0 [--draft] [--channel listed|unlisted]"
  echo ""
  echo "Environment variables:"
  echo "  FIREFOX_API_KEY     JWT issuer (from AMO developer hub)"
  echo "  FIREFOX_API_SECRET  JWT secret (from AMO developer hub)"
  echo ""
  echo "Options:"
  echo "  --draft      Upload only, skip review submission (default: submit for review)"
  echo "  --channel    listed (default) or unlisted"
  echo "  --zip FILE   Upload existing XPI instead of building"
  exit 1
}

PUBLISH=true
CHANNEL="listed"
ZIP_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --draft) PUBLISH=false; shift ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    --zip) ZIP_FILE="$2"; shift 2 ;;
    *) usage ;;
  esac
done

: "${FIREFOX_API_KEY:?Set FIREFOX_API_KEY (from https://addons.mozilla.org/developers/addon/api/key/)}"
: "${FIREFOX_API_SECRET:?Set FIREFOX_API_SECRET}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -z "$ZIP_FILE" ]; then
  ZIP_FILE="/tmp/vizonator-$(date +%Y%m%d%H%M%S).xpi"
  echo "Building XPI..."
  "$SCRIPT_DIR/build-zip.sh" "$ZIP_FILE"
fi

IAT=$(date +%s)
EXP=$((IAT + 300))

JWT_HEADER=$(printf '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
JWT_PAYLOAD=$(printf '{"iss":"%s","jti":"%s","iat":%d,"exp":%d}' \
  "$FIREFOX_API_KEY" "$(date +%s%N | cut -c1-16)" "$IAT" "$EXP" | base64 -w0 | tr '+/' '-_' | tr -d '=')

JWT_SIG=$(printf '%s.%s' "$JWT_HEADER" "$JWT_PAYLOAD" | openssl dgst -sha256 -hmac "$FIREFOX_API_SECRET" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
JWT_TOKEN="${JWT_HEADER}.${JWT_PAYLOAD}.${JWT_SIG}"

echo "Uploading to AMO..."
UPLOAD_RESP=$(curl -s -X POST \
  "${AMO_API}/addons/" \
  -H "Authorization: JWT ${JWT_TOKEN}" \
  -F "upload=@${ZIP_FILE}" \
  -F "version=0.55" \
  -F "channel=${CHANNEL}")

UPLOAD_UUID=$(echo "$UPLOAD_RESP" | grep -o '"uuid":"[^"]*"' | cut -d'"' -f4)
echo "Upload UUID: ${UPLOAD_UUID:-none}"

if [ -z "$UPLOAD_UUID" ]; then
  echo "Upload failed: $UPLOAD_RESP"
  exit 1
fi

if [ "$PUBLISH" = true ]; then
  echo "Submitting for review..."
  REVIEW_RESP=$(curl -s -X PATCH \
    "${AMO_API}/addons/addon/${ADDON_SLUG}/versions/0.55/" \
    -H "Authorization: JWT ${JWT_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"approved\": true}")
  echo "Review response: $REVIEW_RESP"
else
  echo "Uploaded as draft. Run without --draft to submit for review."
fi

echo "Done."
