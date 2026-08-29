#!/bin/sh
set -e

ADDON_SLUG="vizonator"
AMO_API="https://addons.mozilla.org/api/v5"
LICENSE_SLUG="MIT"

usage() {
  echo "Usage: $0 [--draft] [--channel listed|unlisted]"
  echo ""
  echo "Environment variables:"
  echo "  FIREFOX_API_KEY     JWT issuer (from AMO developer hub)"
  echo "  FIREFOX_API_SECRET  JWT secret (from AMO developer hub)"
  echo ""
  echo "Options:"
  echo "  --draft      Upload only, skip version creation (default: create version for review)"
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
VERSION=$(grep '"version"' "$REPO_ROOT/manifest.json" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
echo "Version: $VERSION"

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

# Step 1: Upload the file
echo "Step 1: Uploading file to AMO..."
UPLOAD_RESP=$(curl -s -X POST \
  "${AMO_API}/addons/upload/" \
  -H "Authorization: JWT ${JWT_TOKEN}" \
  -F "upload=@${ZIP_FILE}" \
  -F "channel=${CHANNEL}")

UPLOAD_UUID=$(echo "$UPLOAD_RESP" | grep -o '"uuid":"[^"]*"' | cut -d'"' -f4)
echo "Upload UUID: ${UPLOAD_UUID:-none}"

if [ -z "$UPLOAD_UUID" ]; then
  echo "Upload failed: $UPLOAD_RESP"
  exit 1
fi

if [ "$PUBLISH" = false ]; then
  echo "Uploaded as draft. Run without --draft to create version."
  echo "Done."
  exit 0
fi

# Step 2: Wait for validation
echo "Step 2: Waiting for validation..."
MAX_WAIT=300
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  VALIDATE_RESP=$(curl -s \
    "${AMO_API}/addons/upload/${UPLOAD_UUID}/" \
    -H "Authorization: JWT ${JWT_TOKEN}")
  VALID=$(echo "$VALIDATE_RESP" | grep -o '"valid":[a-z]*' | cut -d: -f2)
  PROCESSED=$(echo "$VALIDATE_RESP" | grep -o '"processed":[a-z]*' | cut -d: -f2)

  if [ "$VALID" = "true" ] && [ "$PROCESSED" = "true" ]; then
    echo "Validation passed."
    break
  elif [ "$VALID" = "false" ] && [ "$PROCESSED" = "true" ]; then
    echo "Validation failed: $VALIDATE_RESP"
    exit 1
  fi

  echo "  Waiting... (${WAITED}s)"
  sleep 10
  WAITED=$((WAITED + 10))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "Validation timeout after ${MAX_WAIT}s"
  exit 1
fi

# Step 3: Create version
echo "Step 3: Creating version ${VERSION}..."
VERSION_RESP=$(curl -s -X POST \
  "${AMO_API}/addons/addon/${ADDON_SLUG}/versions/" \
  -H "Authorization: JWT ${JWT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"upload\":\"${UPLOAD_UUID}\",\"license\":\"${LICENSE_SLUG}\"}")

VERSION_VER=$(echo "$VERSION_RESP" | grep -o '"version":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Created version: ${VERSION_VER:-unknown}"

if [ -z "$VERSION_VER" ]; then
  echo "Version creation failed: $VERSION_RESP"
  exit 1
fi

echo "Submitted for review (channel=${CHANNEL})."
echo "Done."
