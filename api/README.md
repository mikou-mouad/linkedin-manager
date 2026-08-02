# API — Managed Functions (Azure Static Web Apps)

This folder is deployed automatically by Azure Static Web Apps as a **Managed
Function** — no separate Function App resource, no separate deployment step.
It's built and deployed by the same GitHub Actions workflow that deploys the
frontend (`.github/workflows/azure-static-web-apps.yml`), using `api_location: "api"`.

## Local testing
```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
func start
```
You'll need a local `local.settings.json` (not committed) with the same keys
listed in `infra/create-azure-resources.sh`'s `appsettings set` call —
`AzureWebJobsStorage`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`,
`LINKEDIN_REDIRECT_URI`, `IMAGE_CONTAINER_NAME`, `SCHEDULE_TABLE_NAME`,
`TOKEN_TABLE_NAME`.

## Auth model
All routes are `ANONYMOUS` at the Functions level — trust is enforced one
layer up, by the Static Web App's own login gate (`frontend/staticwebapp.config.json`
sets `allowedRoles: ["authenticated"]` on `/*`, which includes `/api/*`). No
function keys, no separate secrets for the frontend to hold.

## Known limitations of this hosting mode (Managed Functions)
- **HTTP triggers only** — no Timer/Queue/Blob triggers. Fine here since
  publishing is manual (Publish Now button), not auto-scheduled.
- **No managed identity / Key Vault references** — LinkedIn's Client ID/Secret
  and the storage connection string are plain app settings (set via
  `az staticwebapp appsettings set`), not Key Vault-backed. Still server-side
  only, never exposed to the browser.
- **Python capped at 3.10** for Managed Functions (pinned in
  `frontend/staticwebapp.config.json` → `platform.apiRuntime`).
- If you ever outgrow these limits, `az staticwebapp` supports linking a
  separate "bring your own Functions" app instead — but that requires the
  Standard plan (~$9/month).

## Publish / cancel a post
```bash
curl -X POST https://<your-swa-hostname>/api/posts/2026-08/<post_id>/publish
curl -X POST https://<your-swa-hostname>/api/posts/2026-08/<post_id>/cancel
```
(When testing against the deployed site, you'll need to be signed in via the
SWA's login gate first — these routes aren't reachable anonymously.)
