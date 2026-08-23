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
SWA="linkedin-manager-web-${SUFFIX}"

echo "Using resource group: $RG (location: $LOCATION)"
echo "Storage account will be: $STORAGE"
echo "Static Web App will be: $SWA"
echo ""

# 1. Storage account — holds images (Blob) and the content calendar (Table)
az storage account create --name "$STORAGE" --resource-group "$RG" --location "$LOCATION" --sku Standard_LRS --kind StorageV2

# 2. Blob container for post images
az storage container create --account-name "$STORAGE" --name post-images --public-access off --auth-mode login

# 3. Table for the post schedule
az storage table create --account-name "$STORAGE" --name PostSchedule --auth-mode login

# 4. Table for storing LinkedIn OAuth tokens
az storage table create --account-name "$STORAGE" --name AuthTokens --auth-mode login

# 5. Static Web App (frontend + Managed Functions API) — Free tier
# NOTE: Static Web Apps is only available in a short list of regions, and
# francecentral is NOT one of them (supported: westus2, centralus, eastus2,
# westeurope, eastasia). Using westeurope — closest supported region.
az staticwebapp create --name "$SWA" --resource-group "$RG" --location westeurope --sku Free

# ---------------------------------------------------------------------------
# 6. App settings for the Managed Functions API.
#
# IMPORTANT: Managed Functions (Free tier) do NOT support managed identity or
# Key Vault references (@Microsoft.KeyVault(...)) — that's a Standard-plan /
# "bring your own Functions" only feature. So these have to be the *actual*
# secret values, set directly as app settings. They still stay server-side
# only (never sent to the browser) — this is just a plainer version of the
# same "keep it out of the frontend" idea, not a security downgrade for users
# of the app, only a downgrade from Key-Vault-backed to plain app settings.
#
# Fetch the real values first (from your existing Key Vault + storage account):
# ---------------------------------------------------------------------------
LINKEDIN_CLIENT_ID=$(az keyvault secret show --vault-name "$KEYVAULT" --name "ClientID" --query value -o tsv)
LINKEDIN_CLIENT_SECRET=$(az keyvault secret show --vault-name "$KEYVAULT" --name "ClientSecret" --query value -o tsv)
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string --name "$STORAGE" --resource-group "$RG" --query connectionString -o tsv)
SWA_HOSTNAME=$(az staticwebapp show --name "$SWA" --resource-group "$RG" --query defaultHostname -o tsv)

az staticwebapp appsettings set --name "$SWA" --setting-names "LINKEDIN_STORAGE_CONNECTION_STRING=$STORAGE_CONNECTION_STRING" "LINKEDIN_CLIENT_ID=$LINKEDIN_CLIENT_ID" "LINKEDIN_CLIENT_SECRET=$LINKEDIN_CLIENT_SECRET" "LINKEDIN_REDIRECT_URI=https://$SWA_HOSTNAME/api/auth/callback" "IMAGE_CONTAINER_NAME=post-images" "SCHEDULE_TABLE_NAME=PostSchedule" "TOKEN_TABLE_NAME=AuthTokens"

# ---------------------------------------------------------------------------
# 7. Restricting who can access the app.
#
# IMPORTANT: A custom Entra (Azure AD) app registration for auth requires the
# Static Web Apps STANDARD plan - not available on Free. So on Free tier, the
# only way to restrict access to just yourself (regardless of which Microsoft
# tenant you sign in from) is SWA's built-in INVITATION system: you invite
# your own account to a custom role, and staticwebapp.config.json's routes
# require that role instead of the generic "authenticated" (which would let
# ANY Microsoft account in, not just you).
#
# This step needs to be run once, manually, with YOUR email - it can't be
# fully scripted generically. Run this yourself after the SWA exists:
#
#   az staticwebapp users invite --name "$SWA" --resource-group "$RG" \
#     --authentication-provider aad --user-details "<your-email>" \
#     --roles "member" --invitation-expiration-in-hours 168 \
#     --domain "$SWA_HOSTNAME"
#
# (--domain is the bare hostname, no https:// prefix)
#
# It prints an invitation URL - open it once, signed in as yourself, to
# accept and get the "member" role. staticwebapp.config.json's routes are
# already set to require allowedRoles: ["member"].
# ---------------------------------------------------------------------------
echo ""
echo "NOTE: To restrict app access to just your account, run the invitation"
echo "command shown in the infra script comments above (needs your email)."

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
#
# NOTE: the Foundry resource name does NOT include "-ai-" - it's just
# "linkedin-manager-${SUFFIX}", confirmed from the actual deployed resource.
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

az staticwebapp appsettings set --name "$SWA" --setting-names "AI_FOUNDRY_ENDPOINT=$FOUNDRY_ENDPOINT" "AI_FOUNDRY_API_KEY=$FOUNDRY_KEY" "AI_FOUNDRY_TEXT_DEPLOYMENT=$TEXT_DEPLOYMENT_NAME" "AI_FOUNDRY_VISION_DEPLOYMENT=$VISION_DEPLOYMENT_NAME" "AI_FOUNDRY_IMAGE_GEN_DEPLOYMENT=$IMAGE_GEN_DEPLOYMENT_NAME"

echo "AI Foundry resource created and wired into the Static Web App's settings."
echo "  Endpoint: $FOUNDRY_ENDPOINT"
echo "  Text (planning/content) deployment: $TEXT_DEPLOYMENT_NAME"
echo "  Vision (matching) deployment:       $VISION_DEPLOYMENT_NAME"
echo "  Image generation deployment:        $IMAGE_GEN_DEPLOYMENT_NAME"

echo ""
echo "Done. Resources created/updated:"
echo "  Storage account: $STORAGE"
echo "  Static Web App:  $SWA (hostname: $SWA_HOSTNAME)"
echo ""
echo "IMPORTANT next step: add this exact redirect URL to your LinkedIn app's"
echo "Auth tab -> Authorized redirect URLs:"
echo "  https://$SWA_HOSTNAME/api/auth/callback"
