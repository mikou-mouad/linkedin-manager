#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Fill this in: 3-5 lowercase letters/numbers unique to you (e.g. initials + a number)
# Storage account names must be globally unique across ALL of Azure, lowercase, no dashes.
# ---------------------------------------------------------------------------
SUFFIX="cdf"

# --- Point to the right subscription ---
az account set --subscription "bddbe6fb-3d67-40ea-959c-45f1ba52510d"

# --- Already existing — do not recreate ---
RG="linkedin-manager"
LOCATION="francecentral"
KEYVAULT="linked-manager"

# --- New/managed resources ---
STORAGE="linkedinmgr${SUFFIX}"
APPSERVICE="linkedin-manager-${SUFFIX}"
APPSERVICE_PLAN="linkedin-manager-plan-${SUFFIX}"

echo "Using resource group: $RG (location: $LOCATION)"
echo "Storage account will be: $STORAGE"
echo "App Service will be: $APPSERVICE"
echo ""

# 1. Storage account — holds images (Blob) and the content calendar (Table)
az storage account create --name "$STORAGE" --resource-group "$RG" --location "$LOCATION" --sku Standard_LRS --kind StorageV2

# 2. Blob container for post images
az storage container create --account-name "$STORAGE" --name post-images --public-access off --auth-mode login

# 3. Table for the post schedule
az storage table create --account-name "$STORAGE" --name PostSchedule --auth-mode login

# 4. Table for storing LinkedIn OAuth tokens
az storage table create --account-name "$STORAGE" --name AuthTokens --auth-mode login

# ---------------------------------------------------------------------------
# 5. App Service (frontend + backend, one Express app) — Free (F1) tier.
# NOTE: Free tier caps at 60 CPU-minutes/day and has no "Always On" (the app
# can cold-start/sleep between uses). Upgrade to Basic (B1, ~$13/month) with
# `az appservice plan update --sku B1` if that becomes a problem.
# ---------------------------------------------------------------------------
az appservice plan create --name "$APPSERVICE_PLAN" --resource-group "$RG" --location "$LOCATION" --is-linux --sku F1

az webapp create --name "$APPSERVICE" --resource-group "$RG" --plan "$APPSERVICE_PLAN" --runtime "NODE:22-lts"

APPSERVICE_HOSTNAME=$(az webapp show --name "$APPSERVICE" --resource-group "$RG" --query defaultHostName -o tsv)

# 5b. Application Insights, for real log visibility.
APPINSIGHTS_NAME="linkedin-manager-insights-${SUFFIX}"
az monitor app-insights component create --app "$APPINSIGHTS_NAME" --location "$LOCATION" --resource-group "$RG" --application-type web
APPINSIGHTS_CONNECTION_STRING=$(az monitor app-insights component show --app "$APPINSIGHTS_NAME" --resource-group "$RG" --query connectionString -o tsv)

# ---------------------------------------------------------------------------
# 6. App settings. App Service supports Key Vault references normally (no
# Managed-Functions-style restriction), but keeping these as plain values for
# now to match what's already set up in Key Vault without adding managed
# identity + RBAC back in - can upgrade to Key Vault references later if
# wanted.
# ---------------------------------------------------------------------------
LINKEDIN_CLIENT_ID=$(az keyvault secret show --vault-name "$KEYVAULT" --name "ClientID" --query value -o tsv)
LINKEDIN_CLIENT_SECRET=$(az keyvault secret show --vault-name "$KEYVAULT" --name "ClientSecret" --query value -o tsv)
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string --name "$STORAGE" --resource-group "$RG" --query connectionString -o tsv)

az webapp config appsettings set --name "$APPSERVICE" --resource-group "$RG" --settings "LINKEDIN_STORAGE_CONNECTION_STRING=$STORAGE_CONNECTION_STRING" "LINKEDIN_CLIENT_ID=$LINKEDIN_CLIENT_ID" "LINKEDIN_CLIENT_SECRET=$LINKEDIN_CLIENT_SECRET" "LINKEDIN_REDIRECT_URI=https://$APPSERVICE_HOSTNAME/api/auth/callback" "IMAGE_CONTAINER_NAME=post-images" "SCHEDULE_TABLE_NAME=PostSchedule" "TOKEN_TABLE_NAME=AuthTokens" "APPLICATIONINSIGHTS_CONNECTION_STRING=$APPINSIGHTS_CONNECTION_STRING" "WEBSITE_NODE_DEFAULT_VERSION=~22"

# ---------------------------------------------------------------------------
# 7. Restrict access to just your account, using App Service's built-in
# Easy Auth with a tenant-restricted Entra app registration - unlike Static
# Web Apps Free tier, App Service does NOT block custom Entra registrations,
# so we can reuse the app registration created earlier (linkedin-manager-swa-auth)
# instead of the Free-tier-only invitation workaround.
# ---------------------------------------------------------------------------
AUTH_APP_NAME="linkedin-manager-swa-auth"
EXISTING_AUTH_APP_ID=$(az ad app list --display-name "$AUTH_APP_NAME" --query "[0].appId" -o tsv)

if [ -n "$EXISTING_AUTH_APP_ID" ]; then
  echo "Reusing existing Entra app registration: $EXISTING_AUTH_APP_ID"
  AUTH_APP_ID="$EXISTING_AUTH_APP_ID"
else
  AUTH_APP_ID=$(az ad app create --display-name "$AUTH_APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)
fi

# App Service's Easy Auth callback path (different from the SWA one this app
# registration originally pointed at) - update its redirect URIs.
az ad app update --id "$AUTH_APP_ID" --web-redirect-uris "https://$APPSERVICE_HOSTNAME/.auth/login/aad/callback"

AUTH_CLIENT_SECRET=$(az ad app credential reset --id "$AUTH_APP_ID" --append --query password -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

az webapp auth microsoft update --name "$APPSERVICE" --resource-group "$RG" --client-id "$AUTH_APP_ID" --client-secret "$AUTH_CLIENT_SECRET" --issuer "https://login.microsoftonline.com/$TENANT_ID/v2.0" --yes

az webapp auth update --name "$APPSERVICE" --resource-group "$RG" --enabled true --action LoginWithAzureActiveDirectory

echo ""
echo "App Service auth configured - tenant-restricted (only accounts in your"
echo "organization can sign in), no invitation workaround needed."

# ---------------------------------------------------------------------------
# 8. AI Foundry resource + model deployments, for the "generate monthly plan"
# / content-generation / image-matching / image-generation features.
#
# Deployed models (all in the same Foundry resource/project):
#   - gpt-5.6-sol   -> monthly planning + post content generation (flagship tier)
#   - gpt-5.6-luna  -> image matching (vision, cheapest tier)
#   - MAI-Image-2.5 -> image generation (fallback when nothing in the pool fits)
#
# These are first-party Azure OpenAI / Microsoft models - no Marketplace/
# partner terms step needed (unlike the DeepSeek/Qwen partner models we
# tried earlier, which aren't deployable on a Visual Studio Enterprise
# subscription).
# ---------------------------------------------------------------------------
FOUNDRY_ACCOUNT="linkedin-manager-${SUFFIX}"
FOUNDRY_LOCATION="swedencentral"
PROJECT_NAME="linkedin-manager-project"

TEXT_DEPLOYMENT_NAME="gpt-5.6-sol"
TEXT_MODEL_NAME="gpt-5.6-sol"

VISION_DEPLOYMENT_NAME="gpt-5.6-luna"
VISION_MODEL_NAME="gpt-5.6-luna"

IMAGE_GEN_DEPLOYMENT_NAME="MAI-Image-2.5"
IMAGE_GEN_MODEL_NAME="MAI-Image-2.5"

echo "Creating AI Foundry resource (with project management enabled)..."
az cognitiveservices account create --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --kind AIServices --sku S0 --location "$FOUNDRY_LOCATION" --custom-domain "$FOUNDRY_ACCOUNT" --allow-project-management --yes

echo "Creating Foundry project..."
az cognitiveservices account project create --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --project-name "$PROJECT_NAME" --location "$FOUNDRY_LOCATION"

echo "Deploying gpt-5.6-sol (planning + content generation)..."
az cognitiveservices account deployment create --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --deployment-name "$TEXT_DEPLOYMENT_NAME" --model-name "$TEXT_MODEL_NAME" --model-format "OpenAI" --model-version "1" --sku-name "GlobalStandard" --sku-capacity 1

echo "Deploying gpt-5.6-luna (image matching / vision)..."
az cognitiveservices account deployment create --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --deployment-name "$VISION_DEPLOYMENT_NAME" --model-name "$VISION_MODEL_NAME" --model-format "OpenAI" --model-version "1" --sku-name "GlobalStandard" --sku-capacity 1

echo "Deploying MAI-Image-2.5 (image generation fallback)..."
az cognitiveservices account deployment create --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --deployment-name "$IMAGE_GEN_DEPLOYMENT_NAME" --model-name "$IMAGE_GEN_MODEL_NAME" --model-format "Microsoft" --model-version "1" --sku-name "GlobalStandard" --sku-capacity 1

FOUNDRY_ENDPOINT=$(az cognitiveservices account show --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --query properties.endpoint -o tsv)
FOUNDRY_KEY=$(az cognitiveservices account keys list --name "$FOUNDRY_ACCOUNT" --resource-group "$RG" --query key1 -o tsv)

az webapp config appsettings set --name "$APPSERVICE" --resource-group "$RG" --settings "AI_FOUNDRY_ENDPOINT=$FOUNDRY_ENDPOINT" "AI_FOUNDRY_API_KEY=$FOUNDRY_KEY" "AI_FOUNDRY_TEXT_DEPLOYMENT=$TEXT_DEPLOYMENT_NAME" "AI_FOUNDRY_VISION_DEPLOYMENT=$VISION_DEPLOYMENT_NAME" "AI_FOUNDRY_IMAGE_GEN_DEPLOYMENT=$IMAGE_GEN_DEPLOYMENT_NAME"

echo "AI Foundry resource created and wired into the App Service's settings."
echo "  Endpoint: $FOUNDRY_ENDPOINT"
echo "  Text (planning/content) deployment: $TEXT_DEPLOYMENT_NAME"
echo "  Vision (matching) deployment:       $VISION_DEPLOYMENT_NAME"
echo "  Image generation deployment:        $IMAGE_GEN_DEPLOYMENT_NAME"

# ---------------------------------------------------------------------------
# 9. Publish profile for GitHub Actions deployment.
# ---------------------------------------------------------------------------
echo ""
echo "Fetching publish profile for GitHub Actions..."
az webapp deployment list-publishing-profiles --name "$APPSERVICE" --resource-group "$RG" --xml > publish-profile.xml
echo "Saved to ./publish-profile.xml"
echo "Add its FULL CONTENTS as a GitHub repo secret named AZURE_APP_SERVICE_PUBLISH_PROFILE"
echo "(Settings -> Secrets and variables -> Actions -> New repository secret)"
echo "Then delete publish-profile.xml locally - don't commit it."

echo ""
echo "Done. Resources created/updated:"
echo "  Storage account: $STORAGE"
echo "  App Service:     $APPSERVICE (hostname: $APPSERVICE_HOSTNAME)"
echo ""
echo "IMPORTANT next step: add this exact redirect URL to your LinkedIn app's"
echo "Auth tab -> Authorized redirect URLs:"
echo "  https://$APPSERVICE_HOSTNAME/api/auth/callback"
