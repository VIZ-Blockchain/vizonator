# Vizonator Auto-Deploy Guide

## Chrome Web Store

### 1. Get OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project or select existing
3. Enable **Chrome Web Store API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://developers.google.com/oauthplayground`
5. Save **Client ID** and **Client Secret**

### 2. Get Refresh Token

1. Open [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
2. Click gear icon → check **Use your own OAuth credentials**
3. Paste Client ID + Secret
4. In "Step 1", enter scope: `https://www.googleapis.com/auth/chromewebstore`
5. Click **Authorize APIs** → sign in with the account that owns the extension
6. Click **Exchange authorization code for tokens**
7. Copy the **Refresh token**

### 3. Store Secrets

Add to GitHub repo secrets (Settings → Secrets → Actions):
- `CHROME_CLIENT_ID`
- `CHROME_CLIENT_SECRET`
- `CHROME_REFRESH_TOKEN`

Or create `.env` file (add to `.gitignore`!):
```bash
CHROME_CLIENT_ID=xxx.apps.googleusercontent.com
CHROME_CLIENT_SECRET=xxx
CHROME_REFRESH_TOKEN=1//xxx
```

### 4. Manual Deploy

```bash
# Upload and submit for review (default)
./bin/publish-chrome.sh

# Upload as draft only (skip review)
./bin/publish-chrome.sh --draft
```

### 5. Auto Deploy on Tag

```bash
git tag v0.56
git push origin v0.56
```

GitHub Actions will build, upload, and submit for review automatically.

---

## Firefox Add-ons (AMO)

### 1. Get API Credentials

1. Go to [AMO Developer Hub](https://addons.mozilla.org/developers/)
2. Click your username → **Edit API Credentials**
3. Click **Create new credentials**
4. Save **JWT Issuer** (API Key) and **JWT Secret** (API Secret)

### 2. Store Secrets

Add to GitHub repo secrets:
- `FIREFOX_API_KEY` (JWT Issuer)
- `FIREFOX_API_SECRET` (JWT Secret)

Or `.env`:
```bash
FIREFOX_API_KEY=user:xxx
FIREFOX_API_SECRET=xxx
```

### 3. Firefox-Specific Manifest

Firefox supports MV3 since v109. Add to `manifest.json`:

```json
{
  "browser_specific_properties": {
    "gecko": {
      "id": "vizonator@viz.world",
      "strict_min_version": "109.0"
    }
  }
}
```

### 4. Manual Deploy

```bash
# Upload and submit for review (default)
./bin/publish-firefox.sh

# Upload as draft only (skip review)
./bin/publish-firefox.sh --draft --channel unlisted
```

**Note:** Listed add-ons require manual review by Mozilla. Unlisted can be auto-approved.

### 5. Auto Deploy on Tag

Same as Chrome — tag triggers both, both submit for review.

---

## Version Bump

Before tagging, update version in `manifest.json`:

```bash
# Edit manifest.json
"version": "0.56"

git add manifest.json
git commit -m "Bump version to 0.56"
git tag v0.56
git push origin main --tags
```

---

## Troubleshooting

### Chrome: "Invalid grant"
Refresh token expired. Re-generate via OAuth Playground.

### Chrome: "Item not found"
Extension ID mismatch. Verify `iehoehfkanaobnbldjfabbpaiiojnp` matches your listing.

### Firefox: "Version already exists"
Bump version in manifest.json and script.

### Firefox: "Signature verification failed"
Check JWT credentials are correct and not expired.

---

## Extension IDs

- **Chrome:** `iehoehfkanaobnbldjfjfabbpaiiojnp`
- **Firefox:** `vizonator@viz.world` (set in manifest.json)

---

## Links

- Chrome listing: https://chrome.google.com/webstore/detail/vizonator/iehoehfkanaobnbldjfjfabbpaiiojnp
- Firefox listing: https://addons.mozilla.org/ru/firefox/addon/vizonator/
- Chrome developer dashboard: https://chrome.google.com/webstore/developer/dashboard
- Firefox developer hub: https://addons.mozilla.org/developers/
