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

az staticwebapp appsettings set --name "$SWA" --setting-names "AzureWebJobsStorage=$STORAGE_CONNECTION_STRING" "LINKEDIN_CLIENT_ID=$LINKEDIN_CLIENT_ID" "LINKEDIN_CLIENT_SECRET=$LINKEDIN_CLIENT_SECRET" "LINKEDIN_REDIRECT_URI=https://$SWA_HOSTNAME/api/auth/callback" "IMAGE_CONTAINER_NAME=post-images" "SCHEDULE_TABLE_NAME=PostSchedule" "TOKEN_TABLE_NAME=AuthTokens"

echo ""
echo "Done. Resources created/updated:"
echo "  Storage account: $STORAGE"
echo "  Static Web App:  $SWA (hostname: $SWA_HOSTNAME)"
echo ""
echo "IMPORTANT next step: add this exact redirect URL to your LinkedIn app's"
echo "Auth tab -> Authorized redirect URLs:"
echo "  https://$SWA_HOSTNAME/api/auth/callback"
