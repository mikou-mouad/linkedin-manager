# LinkedIn Content Manager — Step-by-Step Setup Guide

This guide takes you from zero to a working monthly LinkedIn content planner/publisher, running on Azure free-tier services.

**Stack**: Python Azure Functions (backend + scheduler) + Azure Static Web Apps (frontend) + Azure Table Storage (data) + Azure Blob Storage (images) + Azure Key Vault (secrets).

---

## Phase 0 — Prerequisites

Install locally:
- [ ] Python 3.11
- [ ] [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`)
- [ ] [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local)
- [ ] Node.js 18+ (needed for the Static Web Apps CLI, even though the frontend can be plain HTML/JS)
- [ ] An Azure account (free tier is fine) — `az login` to confirm access
- [ ] A LinkedIn account, and admin access to a LinkedIn Company Page (LinkedIn requires an associated page even for personal-profile posting apps)

---

## Phase 1 — Create the LinkedIn Developer App

1. Go to https://www.linkedin.com/developers/apps and click **Create app**.
2. Fill in:
   - App name (e.g. "My Content Manager")
   - LinkedIn Page — you must link an existing Company Page you admin. If you don't have one, create a minimal Company Page first (it's free and takes 2 minutes).
   - App logo, privacy policy URL — a placeholder URL is fine to start (you can update later before requesting scope approval).
3. After creation, go to the **Auth** tab:
   - Note your **Client ID** and **Client Secret**.
   - Under **OAuth 2.0 settings**, add a **redirect URL**, e.g.:
     `https://<your-function-app-name>.azurewebsites.net/api/auth/callback`
     (You can add `http://localhost:7071/api/auth/callback` too, for local testing.)
4. Go to the **Products** tab and request:
   - **Sign In with LinkedIn using OpenID Connect** (usually auto-approved instantly)
   - **Share on LinkedIn** (grants `w_member_social` — this is the one that lets you post; approval can be instant or take up to a couple weeks depending on LinkedIn's review queue)
5. Once "Share on LinkedIn" is approved, go to **Auth** tab and confirm `w_member_social` (and `openid`, `profile`, `email`) appear under **OAuth 2.0 scopes**.

> You can build and test everything else while waiting for approval — you just won't be able to actually publish until it's granted.

---

## Phase 2 — Create Azure Resources

Run these with the Azure CLI (replace `<name>` placeholders with unique names — storage account names must be globally unique, lowercase, no dashes):

```bash
# Variables
RG="linkedin-manager-rg"
LOCATION="westeurope"
STORAGE="linkedinmgrstore<yourinitials>"
FUNCAPP="linkedin-manager-func-<yourinitials>"
SWA="linkedin-manager-web-<yourinitials>"
KEYVAULT="lkmgr-kv-<yourinitials>"

# Resource group
az group create --name $RG --location $LOCATION

# Storage account (holds images in Blob + calendar data in Table)
az storage account create --name $STORAGE --resource-group $RG \
  --location $LOCATION --sku Standard_LRS --kind StorageV2

# Blob container for images
az storage container create --account-name $STORAGE --name post-images --public-access off

# Table for the content calendar
az storage table create --account-name $STORAGE --name PostSchedule

# Function App (Consumption/free-eligible plan, Python)
az functionapp create --resource-group $RG --consumption-plan-location $LOCATION \
  --runtime python --runtime-version 3.11 --functions-version 4 \
  --name $FUNCAPP --storage-account $STORAGE --os-type Linux

# Key Vault for secrets (client secret, refresh token)
az keyvault create --name $KEYVAULT --resource-group $RG --location $LOCATION

# Static Web App (frontend) — free tier
az staticwebapp create --name $SWA --resource-group $RG --location $LOCATION --sku Free
```

Then store your LinkedIn credentials in Key Vault (never commit them to code):

```bash
az keyvault secret set --vault-name $KEYVAULT --name "LinkedInClientId" --value "<your client id>"
az keyvault secret set --vault-name $KEYVAULT --name "LinkedInClientSecret" --value "<your client secret>"
```

Grant your Function App access to read these secrets (enable a managed identity first):

```bash
az functionapp identity assign --name $FUNCAPP --resource-group $RG
PRINCIPAL_ID=$(az functionapp identity show --name $FUNCAPP --resource-group $RG --query principalId -o tsv)
az keyvault set-policy --name $KEYVAULT --object-id $PRINCIPAL_ID --secret-permissions get list
```

---

## Phase 3 — Get the Backend Code Running Locally

The starter code is in the `backend/` folder (provided alongside this guide). It includes:
- `function_app.py` — HTTP endpoints (CRUD for posts, LinkedIn OAuth start/callback) + the Timer function that publishes due posts.
- `shared/linkedin_auth.py` — OAuth + token refresh logic.
- `shared/storage.py` — Table Storage (calendar) and Blob Storage (images) helpers.
- `shared/models.py` — the Post data model.

Steps:

1. `cd backend`
2. Create a virtual environment and install dependencies:
   ```bash
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
3. Copy `local.settings.json.example` to `local.settings.json` and fill in:
   - `AzureWebJobsStorage` — your storage account connection string (`az storage account show-connection-string --name $STORAGE --resource-group $RG`)
   - `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET` — for local testing only (in Azure, these come from Key Vault instead)
   - `LINKEDIN_REDIRECT_URI` — `http://localhost:7071/api/auth/callback`
4. Run locally:
   ```bash
   func start
   ```
5. Visit `http://localhost:7071/api/auth/start` in your browser — this kicks off the LinkedIn OAuth consent flow. Approve it, and you should land on the callback endpoint, which stores your access + refresh token in Table Storage.
6. Test creating a post via the API (see `backend/README.md` for exact request bodies), then test the timer function manually to confirm it can publish.

---

## Phase 4 — Deploy to Azure

```bash
cd backend
func azure functionapp publish $FUNCAPP
```

Update your LinkedIn app's redirect URL (Phase 1) to include the deployed URL, and update `LINKEDIN_REDIRECT_URI` in the Function App's application settings:

```bash
az functionapp config appsettings set --name $FUNCAPP --resource-group $RG \
  --settings LINKEDIN_REDIRECT_URI="https://$FUNCAPP.azurewebsites.net/api/auth/callback"
```

---

## Phase 5 — Frontend (Calendar UI)

The `frontend/` folder has a minimal starting point (a single HTML/JS page listing the month's posts, letting you edit copy, swap the image, and change the date/status). Deploy it:

```bash
cd frontend
swa deploy --app-name $SWA --resource-group $RG
```

Point the frontend's API base URL (in `frontend/config.js`) at your deployed Function App URL.

---

## Phase 6 — Ongoing Use

- Each month, ask me (Claude) to generate the content plan + draft copy. I'll give you a structured list (date, topic, copy, image brief) you can bulk-import via the API or paste into the UI.
- Upload/assign images to each post slot in Blob Storage via the UI or directly in the Azure Portal / Storage Explorer.
- The Timer function checks daily for posts due "today" and publishes them automatically.
- Review status in the calendar UI; edit or reschedule anything before it goes out.

---

## Phase 7 — Recommended Next Step

This is a real multi-file codebase. From here, I'd recommend opening the scaffolded project in **Claude Code**, where I can keep iterating file-by-file, run the Functions locally with you, debug the OAuth flow live, and build out the frontend UI properly (drag-and-drop calendar, image upload widget, etc.) — that back-and-forth is much faster there than pasting code blocks in this chat.
