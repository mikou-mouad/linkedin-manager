/**
 * LinkedIn OAuth 2.0 (3-legged) + Post API helpers. Supports multiple
 * connected accounts - each account is identified by their LinkedIn member
 * ID (the "sub" from userinfo), and callers pass which account to act as.
 * Scopes needed: openid profile email w_member_social
 * Uses Node's built-in fetch (Node 18+).
 */
const storage = require("./storage");

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
const IMAGES_INIT_URL = "https://api.linkedin.com/rest/images?action=initializeUpload";
const LINKEDIN_VERSION = "202601"; // LinkedIn API version header; check docs before going live

function clientId() {
  return process.env.LINKEDIN_CLIENT_ID;
}
function clientSecret() {
  return process.env.LINKEDIN_CLIENT_SECRET;
}
function redirectUri() {
  return process.env.LINKEDIN_REDIRECT_URI;
}

function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: redirectUri(),
    state,
    scope: "openid profile email w_member_social",
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const resp = await fetch(TOKEN_URL, { method: "POST", body });
  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId(),
    client_secret: clientSecret(),
  });
  const resp = await fetch(TOKEN_URL, { method: "POST", body });
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

/** Fetches the connecting person's LinkedIn member id, urn, and display name. */
async function getUserInfo(accessToken) {
  const resp = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!resp.ok) throw new Error(`userinfo failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  return {
    accountId: data.sub,
    memberUrn: `urn:li:person:${data.sub}`,
    displayName: data.name || data.email || data.sub,
  };
}

/**
 * Completes the OAuth flow for whoever just authorized: stores their tokens
 * under their own account id, so multiple people can each connect their own
 * account without overwriting each other.
 * @returns {{accountId: string, displayName: string}}
 */
async function storeNewAccount(tokenResponse) {
  const accessToken = tokenResponse.access_token;
  const refreshToken = tokenResponse.refresh_token || "";
  const expiresIn = tokenResponse.expires_in || 3600;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { accountId, memberUrn, displayName } = await getUserInfo(accessToken);
  await storage.saveAccount({ accountId, accessToken, refreshToken, expiresAt, memberUrn, displayName });
  return { accountId, displayName };
}

async function getValidAccessToken(accountId) {
  if (!accountId) throw new Error("No LinkedIn account specified for this post - assign one first.");
  const account = await storage.getAccount(accountId);
  if (!account) throw new Error(`No connected LinkedIn account found for id '${accountId}'.`);

  const expiresAt = new Date(account.expiresAt).getTime();
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() >= expiresAt - fiveMinutes) {
    const refreshed = await refreshAccessToken(account.refreshToken);
    const newExpiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
    const newRefreshToken = refreshed.refresh_token || account.refreshToken;
    await storage.saveAccount({
      accountId,
      accessToken: refreshed.access_token,
      refreshToken: newRefreshToken,
      expiresAt: newExpiresAt,
      memberUrn: account.memberUrn,
      displayName: account.displayName,
    });
    return { accessToken: refreshed.access_token, memberUrn: account.memberUrn };
  }
  return { accessToken: account.accessToken, memberUrn: account.memberUrn };
}

async function uploadImageToLinkedIn(accessToken, memberUrn, imageBytes) {
  const initResp = await fetch(IMAGES_INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ initializeUploadRequest: { owner: memberUrn } }),
  });
  if (!initResp.ok) throw new Error(`Image init failed: ${initResp.status} ${await initResp.text()}`);
  const initData = (await initResp.json()).value;
  const uploadUrl = initData.uploadUrl;
  const imageUrn = initData.image;

  const putResp = await fetch(uploadUrl, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: imageBytes,
  });
  if (!putResp.ok) throw new Error(`Image upload failed: ${putResp.status}`);
  return imageUrn;
}

/**
 * Publishes as a specific connected account.
 * @param {string} accountId - which connected account to publish as
 */
async function publishPost(accountId, text, imageBytes = null) {
  const { accessToken, memberUrn } = await getValidAccessToken(accountId);

  const body = {
    author: memberUrn,
    commentary: text,
    visibility: "PUBLIC",
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };

  if (imageBytes) {
    const imageUrn = await uploadImageToLinkedIn(accessToken, memberUrn, imageBytes);
    body.content = { media: { id: imageUrn } };
  }

  const resp = await fetch(POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "LinkedIn-Version": LINKEDIN_VERSION,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`Publish failed: ${resp.status} ${await resp.text()}`);
  return resp.headers.get("x-restli-id") || "";
}

module.exports = {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  storeNewAccount,
  publishPost,
};
