#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Fill this in: 3-5 lowercase letters/numbers unique to you (e.g. initials + a number)
# Storage account names must be globally unique across ALL of Azure, lowercase, no dashes.
# ---------------------------------------------------------------------------
SUFFIX="changeme123"

# --- Point to the right subscription (from your earlier screenshot) ---
az account set --subscription "bddbe6fb-3d67-40ea-959c-45f1ba52510d"

# --- Already existing (from your setup) — do not recreate ---
RG="linkedin-manager"
LOCATION="francecentral"
KEYVAULT="linked-manager"

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

# 5. Function App (Python, Consumption/free-eligible plan, Linux)
az functionapp create --resource-group "$RG" --consumption-plan-location "$LOCATION" --runtime python --runtime-version 3.11 --functions-version 4 --name "$FUNCAPP" --storage-account "$STORAGE" --os-type Linux

# 6. Static Web App (frontend) — Free tier
az staticwebapp create --name "$SWA" --resource-group "$RG" --location "$LOCATION" --sku Free

# 7. Give the Function App a managed identity, then let it read your Key Vault secrets
az functionapp identity assign --name "$FUNCAPP" --resource-group "$RG"

PRINCIPAL_ID=$(az functionapp identity show --name "$FUNCAPP" --resource-group "$RG" --query principalId -o tsv)

az keyvault set-policy --name "$KEYVAULT" --object-id "$PRINCIPAL_ID" --secret-permissions get list

echo ""
echo "Done. Resources created:"
echo "  Storage account: $STORAGE"
echo "  Function App:    $FUNCAPP"
echo "  Static Web App:  $SWA"
echo "  Key Vault access granted to Function App's managed identity."
