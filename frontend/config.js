// No SWA-Function backend linking on the Free tier, so the frontend calls the
// Function App directly and passes its function key on every request.
const API_BASE_URL = "https://linkedin-manager-func-cdf.azurewebsites.net/api";

// Get this from: Function App -> Functions -> App keys -> "default"
// Anyone with this key can create/edit/publish posts on your behalf, so treat
// it like a password - don't commit a real value here to a public repo.
const FUNCTION_KEY = "PASTE_YOUR_FUNCTION_KEY_HERE";
