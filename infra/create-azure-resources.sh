#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Fill this in: 3-5 lowercase letters/numbers unique to you (e.g. initials + a number)
# Storage account names must be globally unique across ALL of Azure, lowercase, no dashes.
# ---------------------------------------------------------------------------
SUFFIX="cdf"

# --- Point to the right subscription (from your earlier screenshot) ---
az account set --subscription "bddbe6fb-3d67-40ea-959c-45f1ba52510d"

# --- Already existing (from your setup) — do not recreate ---
RG="linkedin-manager"
LOCATION="francecentral"
KEYVAULT="linked-manager"

# Your Key Vault was likely created in "Access policy" mode (Azure's default).
# RBAC role assignments only take effect if the vault's authorization model is RBAC,
# so switch it over first. Safe to run even if it's already RBAC-enabled.
az keyvault update --name "$KEYVAULT" --resource-group "$RG" --enable-rbac-authorization true

# --- New resources ---
STORAGE="linkedinmgr${SUFFIX}"
FUNCAPP="linkedin-manager-func-${SUFFIX}"
SWA="linkedin-manager-web-${SUFFIX}"

echo "Using subscription: bddbe6fb-3d67-40ea-959c-45f1ba52510d"
echo "Using resource group: $RG (location: $LOCATION)"
echo "Storage account will be: $STORAGE"
echo "Function app will be: $FUNCAPP"
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

# 5. Function App (Python, Flex Consumption plan, Linux)
# Flex Consumption is Azure's recommended serverless plan going forward (Linux
# Consumption is on a deprecation path, EOL Sept 30, 2028). Still free-tier friendly.
# App Insights is kept (created automatically alongside the app).
az functionapp create --resource-group "$RG" --name "$FUNCAPP" --storage-account "$STORAGE" --flexconsumption-location "$LOCATION" --runtime python --runtime-version 3.11

# 6. Static Web App (frontend) — Free tier
# NOTE: Static Web Apps is only available in a short list of regions, and
# francecentral is NOT one of them (supported: westus2, centralus, eastus2,
# westeurope, eastasia). Using westeurope here — closest supported region.
# This is fine even though your other resources are in francecentral; the
# Static Web App only hosts static frontend files, no data residency concern.
az staticwebapp create --name "$SWA" --resource-group "$RG" --location westeurope --sku Free

# 7. Give the Function App a managed identity, then let it read your Key Vault secrets via RBAC
az functionapp identity assign --name "$FUNCAPP" --resource-group "$RG"

PRINCIPAL_ID=$(az functionapp identity show --name "$FUNCAPP" --resource-group "$RG" --query principalId -o tsv)

KEYVAULT_ID=$(az keyvault show --name "$KEYVAULT" --resource-group "$RG" --query id -o tsv)

az role assignment create --assignee "$PRINCIPAL_ID" --role "Key Vault Secrets User" --scope "$KEYVAULT_ID"

# 8. Configure the Function App's settings — LinkedIn secrets via Key Vault reference,
# plus the storage container/table names the code expects.
az functionapp config appsettings set --name "$FUNCAPP" --resource-group "$RG" --settings "LINKEDIN_CLIENT_ID=@Microsoft.KeyVault(VaultName=$KEYVAULT;SecretName=ClientID)" "LINKEDIN_CLIENT_SECRET=@Microsoft.KeyVault(VaultName=$KEYVAULT;SecretName=ClientSecret)" "LINKEDIN_REDIRECT_URI=https://$FUNCAPP.azurewebsites.net/api/auth/callback" "IMAGE_CONTAINER_NAME=post-images" "SCHEDULE_TABLE_NAME=PostSchedule" "TOKEN_TABLE_NAME=AuthTokens"

# NOTE: We are NOT linking the Function App as the SWA's "bring your own backend" -
# that feature requires the Static Web Apps Standard plan (~$9/month), and we're
# staying on Free. Instead, the frontend calls the Function App's full URL
# directly and passes its function key on each request (see frontend/config.js).
# The Static Web App still gets its own built-in login gate (staticwebapp.config.json)
# as a separate layer, independent of this.

echo ""
echo "Done. Resources created:"
echo "  Storage account: $STORAGE"
echo "  Function App:    $FUNCAPP"
echo "  Static Web App:  $SWA"
echo "  Key Vault access granted to Function App's managed identity."
