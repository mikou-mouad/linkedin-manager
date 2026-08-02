# API — Managed Functions (Node.js, Azure Static Web Apps)

Deployed automatically by Azure Static Web Apps as a Managed Function — no
separate Function App resource. Built and deployed by
`.github/workflows/azure-static-web-apps.yml`, using `api_location: "api"`.
Uses the Azure Functions v4 programming model (`app.http(...)` registrations).

## Local testing
```bash
cd api
npm install
func start
```
You'll need a local `local.settings.json` (not committed) with:
```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "LINKEDIN_STORAGE_CONNECTION_STRING": "<connection string>",
    "LINKEDIN_CLIENT_ID": "...",
    "LINKEDIN_CLIENT_SECRET": "...",
    "LINKEDIN_REDIRECT_URI": "http://localhost:7071/api/auth/callback",
    "IMAGE_CONTAINER_NAME": "post-images",
    "SCHEDULE_TABLE_NAME": "PostSchedule",
    "TOKEN_TABLE_NAME": "AuthTokens"
  }
}
```
Note: `AzureWebJobsStorage` (and anything prefixed `AzureWebJobs*`) is a
**reserved app setting name on Managed Functions** - the platform manages its
own internal storage account under that name and won't let you override it.
Our own storage connection lives under `LINKEDIN_STORAGE_CONNECTION_STRING` instead.

## Auth model
All routes are `authLevel: "anonymous"` — trust is enforced one layer up, by
the Static Web App's own login gate (`src/public/staticwebapp.config.json`
sets `allowedRoles: ["authenticated"]` on `/*`, which includes `/api/*`). No
function keys.

## Known limitations of Managed Functions
- HTTP triggers only — fine here since publishing is manual (Publish Now
  button), not auto-scheduled.
- No managed identity / Key Vault references — secrets are plain app settings
  (`az staticwebapp appsettings set`), still server-side only.
- Node.js version is pinned in `src/public/staticwebapp.config.json` →
  `platform.apiRuntime`.

## Publish / cancel a post
```bash
curl -X POST https://<your-swa-hostname>/api/posts/2026-08/<post_id>/publish
curl -X POST https://<your-swa-hostname>/api/posts/2026-08/<post_id>/cancel
```
(Against the deployed site you'll need to be signed in via the login gate
first — these routes aren't reachable anonymously from outside.)
