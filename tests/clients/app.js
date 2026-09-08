/**
 * Apigee OAuth 2.1 & OIDC Interactive Client Tester
 */

// --- Default Configuration & Endpoints ---
const DEFAULT_CONFIG = {
  serverUrl: window.location.origin,
  clientId: "",
  clientSecret: "",
  scopes: "openid profile email mcp",
  apiKey: ""
};

const DEFAULT_ENDPOINTS = [
  {
    id: "mcp-meta",
    name: "MCP Protected Resource Metadata",
    method: "GET",
    path: "/.well-known/oauth-protected-resource",
    authMode: "none",
    headers: "Accept: application/json",
    body: ""
  },
  {
    id: "oidc-discovery",
    name: "OIDC Server Discovery",
    method: "GET",
    path: "/.well-known/openid-configuration",
    authMode: "none",
    headers: "Accept: application/json",
    body: ""
  },
  {
    id: "userinfo",
    name: "OIDC UserInfo Endpoint",
    method: "GET",
    path: "/userinfo",
    authMode: "bearer",
    headers: "Accept: application/json",
    body: ""
  },
  {
    id: "mcp-messages",
    name: "MCP JSON-RPC Tools Request",
    method: "POST",
    path: "/mcp/messages",
    authMode: "bearer",
    headers: "Content-Type: application/json\nAccept: application/json",
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
      id: 1
    }, null, 2)
  },
  {
    id: "mcp-sse",
    name: "MCP SSE Stream Endpoint",
    method: "GET",
    path: "/mcp/sse",
    authMode: "bearer",
    headers: "Accept: text/event-stream",
    body: ""
  },
  {
    id: "protected-api",
    name: "Protected Backend Resource",
    method: "GET",
    path: "/api/v1/resource",
    authMode: "bearer",
    headers: "Accept: application/json",
    body: ""
  }
];

// --- State Store ---
const state = {
  config: { ...DEFAULT_CONFIG },
  tokens: {
    accessToken: "",
    idToken: "",
    refreshToken: "",
    tokenType: "Bearer"
  },
  endpoints: [...DEFAULT_ENDPOINTS],
  selectedEndpointId: "mcp-meta",
  currentStep: 1
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  loadStoredState();
  initUI();
  handleOAuthCallback();
  updateUI();
  autoAdvanceInitialStep();
});

// --- Local Storage & Auto-Save Management ---
function loadStoredState() {
  try {
    const storedCfg = localStorage.getItem("apigee_tester_cfg");
    if (storedCfg) state.config = { ...state.config, ...JSON.parse(storedCfg) };

    const storedTokens = localStorage.getItem("apigee_tester_tokens");
    if (storedTokens) state.tokens = { ...state.tokens, ...JSON.parse(storedTokens) };

    const storedEndpoints = localStorage.getItem("apigee_tester_endpoints");
    if (storedEndpoints) state.endpoints = JSON.parse(storedEndpoints);
  } catch (err) {
    console.error("Failed to load local state:", err);
  }

  // Ensure redirect URI points to current page without query / hash
  const currentUrl = new URL(window.location.href);
  currentUrl.search = "";
  currentUrl.hash = "";
  state.config.redirectUri = currentUrl.toString();
}

let autoSaveTimer = null;
function autoSaveConfig(notify = true) {
  state.config.serverUrl = document.getElementById("cfg-server-url").value.trim().replace(/\/+$/, "");
  state.config.clientId = document.getElementById("cfg-client-id").value.trim();
  state.config.clientSecret = document.getElementById("cfg-client-secret").value.trim();
  state.config.scopes = document.getElementById("cfg-scopes").value.trim();
  state.config.apiKey = document.getElementById("cfg-api-key").value.trim();

  localStorage.setItem("apigee_tester_cfg", JSON.stringify(state.config));

  if (notify) {
    const tag = document.getElementById("auto-save-tag");
    if (tag) {
      tag.classList.add("visible");
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        tag.classList.remove("visible");
      }, 1500);
    }
  }

  updateWorkflowState();
}

function saveTokenState() {
  localStorage.setItem("apigee_tester_tokens", JSON.stringify(state.tokens));
  updateWorkflowState();
}

function clearAllState() {
  if (confirm("Reset all stored tokens and settings to default?")) {
    localStorage.removeItem("apigee_tester_cfg");
    localStorage.removeItem("apigee_tester_tokens");
    sessionStorage.clear();
    state.config = { ...DEFAULT_CONFIG };
    state.tokens = { accessToken: "", idToken: "", refreshToken: "", tokenType: "Bearer" };
    state.endpoints = [...DEFAULT_ENDPOINTS];
    loadStoredState();
    updateUI();
    switchStep(1);
    showToast("State reset to defaults", "info");
  }
}

function clearClientRegistration() {
  state.config.clientId = "";
  state.config.clientSecret = "";
  state.tokens = { accessToken: "", idToken: "", refreshToken: "", tokenType: "Bearer" };

  document.getElementById("cfg-client-id").value = "";
  document.getElementById("cfg-client-secret").value = "";
  document.getElementById("manual-client-id").value = "";
  document.getElementById("manual-client-secret").value = "";
  document.getElementById("cimd-url-input").value = "";

  autoSaveConfig(false);
  saveTokenState();
  updateUI();
  switchStep(1);
  showToast("Client registration and tokens cleared.", "info");
}

// --- Progressive Stepper Workflow ---
function autoAdvanceInitialStep() {
  const hasClient = Boolean(state.config.clientId);
  const hasToken = Boolean(state.tokens.accessToken);

  if (hasToken) {
    switchStep(3);
  } else if (hasClient) {
    switchStep(2);
  } else {
    switchStep(1);
  }
}

function switchStep(step) {
  state.currentStep = step;

  // Update Stepper Navigation Bar
  document.querySelectorAll(".step-item").forEach(item => {
    const s = parseInt(item.getAttribute("data-step"), 10);
    item.classList.toggle("active", s === step);
  });

  // Update Views
  document.querySelectorAll(".tab-content").forEach(content => {
    content.classList.toggle("active", content.id === `view-step-${step}`);
  });
}

function updateWorkflowState() {
  const hasClient = Boolean(state.config.clientId);
  const hasToken = Boolean(state.tokens.accessToken);
  const isCimd = state.config.clientId.startsWith("http://") || state.config.clientId.startsWith("https://");

  // Server dot & text
  const srvDot = document.getElementById("server-status-dot");
  const srvText = document.getElementById("server-status-text");
  if (state.config.serverUrl) {
    srvDot.className = "status-dot active";
    srvText.textContent = "Configured";
  } else {
    srvDot.className = "status-dot";
    srvText.textContent = "Disconnected";
  }

  // Client dot & text
  const clientDot = document.getElementById("client-status-dot");
  const clientText = document.getElementById("client-status-text");
  const badgeClientMode = document.getElementById("badge-client-mode");

  if (hasClient) {
    clientDot.className = "status-dot active";
    if (isCimd) {
      clientText.textContent = "CIMD Client";
      badgeClientMode.textContent = "CIMD";
      badgeClientMode.className = "badge badge-success";
    } else if (state.config.clientSecret) {
      clientText.textContent = "Confidential App";
      badgeClientMode.textContent = "Confidential";
      badgeClientMode.className = "badge badge-info";
    } else {
      clientText.textContent = "Public App";
      badgeClientMode.textContent = "Public (PKCE)";
      badgeClientMode.className = "badge badge-success";
    }
  } else {
    clientDot.className = "status-dot";
    clientText.textContent = "Unregistered";
    badgeClientMode.textContent = "Unregistered";
    badgeClientMode.className = "badge badge-warning";
  }

  // Token dot & text
  const tokenDot = document.getElementById("token-status-dot");
  const tokenText = document.getElementById("token-status-text");
  if (hasToken) {
    tokenDot.className = "status-dot active";
    tokenText.textContent = "Active Token";
  } else {
    tokenDot.className = "status-dot";
    tokenText.textContent = "No Token";
  }

  // Step 1 Stepper Item State
  const stepNav1 = document.getElementById("step-nav-1");
  const stepNum1 = document.getElementById("step-num-1");
  const registeredBanner = document.getElementById("client-registered-banner");
  const registrationWorkarea = document.getElementById("client-registration-workarea");
  const registeredIdLabel = document.getElementById("client-registered-id-label");

  if (hasClient) {
    stepNav1.classList.add("completed");
    stepNum1.innerHTML = "✓";
    registeredBanner.style.display = "flex";
    registeredIdLabel.textContent = state.config.clientId;
    registrationWorkarea.style.display = "none";
  } else {
    stepNav1.classList.remove("completed");
    stepNum1.textContent = "1";
    registeredBanner.style.display = "none";
    registrationWorkarea.style.display = "block";
  }

  // Step 2 Stepper Item State
  const stepNav2 = document.getElementById("step-nav-2");
  const stepNum2 = document.getElementById("step-num-2");
  const step2Locked = document.getElementById("step-2-locked-banner");
  const step2Content = document.getElementById("step-2-content");
  const tokensActiveBanner = document.getElementById("tokens-active-banner");

  if (!hasClient) {
    stepNav2.classList.add("disabled");
    stepNav2.classList.remove("completed");
    stepNum2.textContent = "2";
    step2Locked.style.display = "flex";
    step2Content.style.display = "none";
  } else {
    stepNav2.classList.remove("disabled");
    step2Locked.style.display = "none";
    step2Content.style.display = "block";

    if (hasToken) {
      stepNav2.classList.add("completed");
      stepNum2.innerHTML = "✓";
      tokensActiveBanner.style.display = "flex";
    } else {
      stepNav2.classList.remove("completed");
      stepNum2.textContent = "2";
      tokensActiveBanner.style.display = "none";
    }
  }

  // Step 3 Stepper Item State
  const step3Locked = document.getElementById("step-3-locked-banner");
  if (!hasToken) {
    step3Locked.style.display = "flex";
  } else {
    step3Locked.style.display = "none";
  }
}

// --- PKCE Helpers (RFC 7636) ---
function generateRandomString(length = 64) {
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const randomValues = new Uint8Array(length);
  window.crypto.getRandomValues(randomValues);
  return Array.from(randomValues).map(v => charset[v % charset.length]).join("");
}

async function sha256(plain) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- OAuth 2.1 / OIDC PKCE Login ---
async function startPKCELogin() {
  if (!state.config.serverUrl) {
    showToast("Please enter OAuth / OIDC Server URL first", "error");
    return;
  }
  if (!state.config.clientId) {
    showToast("Please register a client in Step 1 first", "error");
    switchStep(1);
    return;
  }

  const codeVerifier = generateRandomString(64);
  const challengeBuffer = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(challengeBuffer);
  const stateVal = generateRandomString(32);

  sessionStorage.setItem("pkce_verifier", codeVerifier);
  sessionStorage.setItem("oauth_state", stateVal);

  const authUrl = new URL(`${state.config.serverUrl}/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", state.config.clientId);
  authUrl.searchParams.set("redirect_uri", state.config.redirectUri);
  authUrl.searchParams.set("scope", state.config.scopes);
  authUrl.searchParams.set("state", stateVal);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  showToast("Redirecting to Apigee sign-in...", "info");
  setTimeout(() => {
    window.location.href = authUrl.toString();
  }, 350);
}

// --- Handle Callback from Authorization Server ---
async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const stateVal = params.get("state");
  const error = params.get("error");
  const errorDesc = params.get("error_description");

  if (error) {
    showToast(`OAuth Error: ${error} - ${errorDesc || ""}`, "error");
    cleanBrowserUrl();
    return;
  }

  if (code) {
    const savedState = sessionStorage.getItem("oauth_state");
    const codeVerifier = sessionStorage.getItem("pkce_verifier");

    if (savedState && stateVal !== savedState) {
      showToast("State mismatch error (CSRF check failed)", "error");
      cleanBrowserUrl();
      return;
    }

    showToast("Exchanging authorization code for tokens...", "info");
    await exchangeCodeForToken(code, codeVerifier);
    cleanBrowserUrl();
  }
}

function cleanBrowserUrl() {
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, document.title, cleanUrl);
}

// --- Token Exchange ---
async function exchangeCodeForToken(code, codeVerifier) {
  try {
    const tokenUrl = `${state.config.serverUrl}/token`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: state.config.redirectUri,
      client_id: state.config.clientId,
      code_verifier: codeVerifier || ""
    });

    if (state.config.clientSecret) {
      body.set("client_secret", state.config.clientSecret);
    }

    const res = await fetch(resolveRequestUrl(tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    }

    state.tokens.accessToken = data.access_token || "";
    state.tokens.idToken = data.id_token || "";
    state.tokens.refreshToken = data.refresh_token || "";
    state.tokens.tokenType = data.token_type || "Bearer";
    saveTokenState();

    showToast("Authentication successful! Acquired tokens.", "success");
    decodeAndRenderTokens();
    updateUI();
    switchStep(3);
  } catch (err) {
    showToast(`Token Exchange Failed: ${err.message}`, "error");
  }
}

// --- Client Credentials Flow ---
async function getClientCredentialsToken() {
  if (!state.config.clientId) {
    showToast("Client ID is required", "error");
    switchStep(1);
    return;
  }

  try {
    const tokenUrl = `${state.config.serverUrl}/token`;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: state.config.clientId,
      scope: state.config.scopes
    });

    if (state.config.clientSecret) {
      body.set("client_secret", state.config.clientSecret);
    }

    const res = await fetch(resolveRequestUrl(tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    }

    state.tokens.accessToken = data.access_token || "";
    state.tokens.idToken = data.id_token || "";
    state.tokens.tokenType = data.token_type || "Bearer";
    saveTokenState();

    showToast("Client Credentials token acquired!", "success");
    decodeAndRenderTokens();
    updateUI();
    switchStep(3);
  } catch (err) {
    showToast(`Token Request Failed: ${err.message}`, "error");
  }
}

// --- Refresh Token Flow ---
async function refreshAccessToken() {
  if (!state.tokens.refreshToken) {
    showToast("No refresh token available", "warning");
    return;
  }

  try {
    const tokenUrl = `${state.config.serverUrl}/token`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.tokens.refreshToken,
      client_id: state.config.clientId
    });

    if (state.config.clientSecret) {
      body.set("client_secret", state.config.clientSecret);
    }

    const res = await fetch(resolveRequestUrl(tokenUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
    }

    state.tokens.accessToken = data.access_token || "";
    if (data.id_token) state.tokens.idToken = data.id_token;
    if (data.refresh_token) state.tokens.refreshToken = data.refresh_token;
    saveTokenState();

    showToast("Token refreshed successfully!", "success");
    decodeAndRenderTokens();
    updateUI();
  } catch (err) {
    showToast(`Refresh Failed: ${err.message}`, "error");
  }
}

// --- Introspect Token ---
async function introspectToken() {
  if (!state.tokens.accessToken) {
    showToast("No access token to introspect", "warning");
    return;
  }

  try {
    const introspectUrl = `${state.config.serverUrl}/introspect`;
    const body = new URLSearchParams({
      token: state.tokens.accessToken,
      client_id: state.config.clientId || ""
    });

    const res = await fetch(resolveRequestUrl(introspectUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    const data = await res.json();
    alert(`Token Introspection Result:\n\n${JSON.stringify(data, null, 2)}`);
  } catch (err) {
    showToast(`Introspection failed: ${err.message}`, "error");
  }
}

// --- Revoke Token ---
async function revokeToken() {
  if (!state.tokens.accessToken && !state.tokens.refreshToken) {
    showToast("No token to revoke", "warning");
    return;
  }

  try {
    const revokeUrl = `${state.config.serverUrl}/revoke`;
    const body = new URLSearchParams({
      token: state.tokens.accessToken || state.tokens.refreshToken,
      client_id: state.config.clientId || ""
    });

    const res = await fetch(resolveRequestUrl(revokeUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (res.ok) {
      state.tokens.accessToken = "";
      state.tokens.idToken = "";
      state.tokens.refreshToken = "";
      saveTokenState();
      showToast("Token revoked successfully", "success");
      decodeAndRenderTokens();
      updateUI();
    } else {
      showToast(`Revocation failed with status ${res.status}`, "error");
    }
  } catch (err) {
    showToast(`Revocation error: ${err.message}`, "error");
  }
}

// --- Dynamic Client Registration (DCR) ---
async function executeDCR() {
  const dcrUrl = `${state.config.serverUrl}/register`;
  const payloadStr = document.getElementById("dcr-payload-editor").value;
  const resBox = document.getElementById("dcr-response-box");

  try {
    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      throw new Error("Invalid JSON in DCR registration payload");
    }

    resBox.textContent = "// Registering client with Apigee...";
    const res = await fetch(resolveRequestUrl(dcrUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    resBox.textContent = JSON.stringify(data, null, 2);

    if (data.client_id) {
      state.config.clientId = data.client_id;
      document.getElementById("cfg-client-id").value = data.client_id;
      if (data.client_secret) {
        state.config.clientSecret = data.client_secret;
        document.getElementById("cfg-client-secret").value = data.client_secret;
      }
      autoSaveConfig(false);
      updateUI();
      showToast("DCR succeeded! Client registered. Moving to Step 2.", "success");
      setTimeout(() => switchStep(2), 600);
    } else {
      showToast("DCR completed with unexpected response", "warning");
    }
  } catch (err) {
    resBox.textContent = `// Error: ${err.message}`;
    showToast(`DCR Failed: ${err.message}`, "error");
  }
}

// --- Discovery Metadata ---
async function discoverMetadata() {
  if (!state.config.serverUrl) {
    showToast("Enter server URL first", "error");
    return;
  }

  try {
    const oidcUrl = `${state.config.serverUrl}/.well-known/openid-configuration`;
    const res = await fetch(resolveRequestUrl(oidcUrl));
    const data = await res.json();

    document.getElementById("server-status-dot").className = "status-dot active";
    document.getElementById("server-status-text").textContent = "Connected";

    showToast("OIDC Discovery successful!", "success");

    document.getElementById("res-headers-box").textContent = JSON.stringify({
      status: res.status,
      issuer: data.issuer,
      authorization_endpoint: data.authorization_endpoint,
      token_endpoint: data.token_endpoint,
      userinfo_endpoint: data.userinfo_endpoint
    }, null, 2);
    document.getElementById("res-body-box").textContent = JSON.stringify(data, null, 2);
    document.getElementById("res-status-badge").textContent = `${res.status} OK`;
    document.getElementById("res-status-badge").className = "badge badge-success";

    switchStep(3);
  } catch (err) {
    document.getElementById("server-status-dot").className = "status-dot";
    document.getElementById("server-status-text").textContent = "Disconnected";
    showToast(`Discovery failed: ${err.message}. Direct CORS fetch supported.`, "error");
  }
}

// --- Fetch UserInfo ---
async function fetchUserInfo() {
  if (!state.tokens.accessToken) {
    showToast("Sign in first to obtain an Access Token", "warning");
    switchStep(2);
    return;
  }

  const userinfoBox = document.getElementById("userinfo-response-box");
  try {
    userinfoBox.textContent = "// Calling /userinfo...";
    const userinfoUrl = `${state.config.serverUrl}/userinfo`;
    const res = await fetch(resolveRequestUrl(userinfoUrl), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${state.tokens.accessToken}`
      }
    });

    const data = await res.json();
    userinfoBox.textContent = JSON.stringify(data, null, 2);
    showToast("UserInfo retrieved successfully!", "success");
  } catch (err) {
    userinfoBox.textContent = `// Error: ${err.message}`;
    showToast(`UserInfo failed: ${err.message}`, "error");
  }
}

// --- Token Claims Decoding & Table ---
function decodeJwt(jwt) {
  try {
    if (!jwt) return null;
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(atob(base64).split("").map(c => {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(""));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function decodeAndRenderTokens() {
  const tableBody = document.getElementById("claims-table-body");
  const tokenToDecode = state.tokens.idToken || state.tokens.accessToken;

  if (!tokenToDecode) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-dim); padding: 24px;">No token decoded. Sign in in Step 2 to inspect claims.</td></tr>`;
    return;
  }

  const claims = decodeJwt(tokenToDecode);
  if (!claims) {
    tableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 24px;">Token is in opaque format (not a JWT). User info can still be inspected via /userinfo.</td></tr>`;
    return;
  }

  const claimDescriptions = {
    sub: "Subject (Unique User / App ID)",
    iss: "Issuer (Authorization Server URL)",
    aud: "Audience (Target Client ID / Resource)",
    exp: "Expiration Timestamp",
    iat: "Issued At Timestamp",
    auth_time: "User Authentication Timestamp",
    email: "User Email Address",
    email_verified: "Email Verification Status",
    name: "User Full Name",
    given_name: "First Name",
    family_name: "Last Name",
    scope: "Granted OAuth Scopes",
    client_id: "OAuth Client ID"
  };

  let rows = "";
  for (const [key, val] of Object.entries(claims)) {
    let displayVal = val;
    if (key === "exp" || key === "iat" || key === "auth_time") {
      const date = new Date(val * 1000);
      displayVal = `${val} (${date.toLocaleString()})`;
    } else if (typeof val === "object") {
      displayVal = JSON.stringify(val);
    }

    rows += `
      <tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td style="color: var(--text-muted);">${escapeHtml(claimDescriptions[key] || "Custom Claim")}</td>
        <td><strong>${escapeHtml(String(displayVal))}</strong></td>
      </tr>
    `;
  }
  tableBody.innerHTML = rows;
}

// --- API & MCP Endpoint Tester Execution ---
async function sendApiTestRequest() {
  const method = document.getElementById("req-method").value;
  const rawUrl = document.getElementById("req-url").value.trim();
  const rawHeaders = document.getElementById("req-headers").value.trim();
  const rawBody = document.getElementById("req-body").value.trim();
  const authMode = document.querySelector('input[name="req-auth-mode"]:checked')?.value || "bearer";

  if (!rawUrl) {
    showToast("Please enter a target URL", "error");
    return;
  }

  const headers = {};
  if (rawHeaders) {
    rawHeaders.split("\n").forEach(line => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const k = line.substring(0, colonIdx).trim();
        const v = line.substring(colonIdx + 1).trim();
        headers[k] = v;
      }
    });
  }

  // Inject chosen authentication mode
  if (authMode === "bearer") {
    if (state.tokens.accessToken) {
      headers["Authorization"] = `Bearer ${state.tokens.accessToken}`;
    } else {
      showToast("Warning: No Bearer token available. Request sent unauthenticated.", "warning");
    }
  } else if (authMode === "apikey") {
    if (state.config.apiKey) {
      headers["x-api-key"] = state.config.apiKey;
    } else {
      showToast("Warning: No API Key configured in settings.", "warning");
    }
  }

  const reqOptions = {
    method: method,
    headers: headers
  };

  if (method !== "GET" && method !== "HEAD" && rawBody) {
    reqOptions.body = rawBody;
  }

  const startTime = performance.now();
  const statusBadge = document.getElementById("res-status-badge");
  const timeBadge = document.getElementById("res-time-badge");
  const headersBox = document.getElementById("res-headers-box");
  const bodyBox = document.getElementById("res-body-box");

  statusBadge.textContent = "Sending...";
  statusBadge.className = "badge";

  try {
    const finalUrl = resolveRequestUrl(rawUrl);
    const res = await fetch(finalUrl, reqOptions);
    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);

    timeBadge.textContent = `${duration} ms`;
    statusBadge.textContent = `${res.status} ${res.statusText}`;

    if (res.status >= 200 && res.status < 300) {
      statusBadge.className = "badge badge-success";
    } else if (res.status === 401 || res.status === 403) {
      statusBadge.className = "badge badge-danger";
    } else {
      statusBadge.className = "badge badge-warning";
    }

    const resHeaders = {};
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
    headersBox.textContent = JSON.stringify(resHeaders, null, 2);

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = await res.json();
      bodyBox.textContent = JSON.stringify(json, null, 2);
    } else {
      const text = await res.text();
      bodyBox.textContent = text || "// Empty response body";
    }
  } catch (err) {
    statusBadge.textContent = "Network Error";
    statusBadge.className = "badge badge-danger";
    headersBox.textContent = "// Request failed";
    bodyBox.textContent = `Error: ${err.message}\n\nTip: Directly connects to Apigee via CORS. If proxying through python, enable checkbox in sidebar.`;
  }
}

function resolveRequestUrl(url) {
  const useProxy = document.getElementById("chk-use-proxy").checked;
  if (useProxy && url.startsWith("http")) {
    return `/api-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

// --- Endpoint List UI ---
function renderEndpointsList() {
  const container = document.getElementById("endpoints-list-container");
  container.innerHTML = "";

  state.endpoints.forEach(ep => {
    const item = document.createElement("div");
    item.className = `endpoint-item ${ep.id === state.selectedEndpointId ? "active" : ""}`;
    const methodLower = ep.method.toLowerCase();
    item.innerHTML = `
      <div class="endpoint-item-top">
        <span class="endpoint-method method-${methodLower}">${ep.method}</span>
        <span class="badge" style="font-size: 9px;">${ep.authMode}</span>
      </div>
      <div class="endpoint-name">${escapeHtml(ep.name)}</div>
      <div class="endpoint-path">${escapeHtml(ep.path)}</div>
    `;

    item.addEventListener("click", () => {
      selectEndpoint(ep.id);
    });
    container.appendChild(item);
  });
}

function selectEndpoint(id) {
  state.selectedEndpointId = id;
  const ep = state.endpoints.find(e => e.id === id);
  if (!ep) return;

  renderEndpointsList();

  document.getElementById("req-method").value = ep.method;

  let targetUrl = ep.path;
  if (targetUrl.startsWith("/")) {
    targetUrl = `${state.config.serverUrl}${ep.path}`;
  }
  document.getElementById("req-url").value = targetUrl;
  document.getElementById("req-headers").value = ep.headers || "";
  document.getElementById("req-body").value = ep.body || "";

  const authRadio = document.querySelector(`input[name="req-auth-mode"][value="${ep.authMode || 'bearer'}"]`);
  if (authRadio) authRadio.checked = true;
}

function addCustomEndpoint() {
  const name = prompt("Endpoint Name (e.g., My MCP Tool):");
  if (!name) return;
  const path = prompt("Path or Full URL (e.g., /mcp/call or https://...):", "/mcp/tools");
  if (!path) return;
  const method = prompt("HTTP Method (GET, POST, etc.):", "POST") || "POST";

  const newEp = {
    id: "custom-" + Date.now(),
    name: name,
    method: method.toUpperCase(),
    path: path,
    authMode: "bearer",
    headers: "Content-Type: application/json\nAccept: application/json",
    body: "{\n  \n}"
  };

  state.endpoints.push(newEp);
  localStorage.setItem("apigee_tester_endpoints", JSON.stringify(state.endpoints));
  selectEndpoint(newEp.id);
  showToast(`Added endpoint: ${name}`, "success");
}

function updateUI() {
  document.getElementById("cfg-server-url").value = state.config.serverUrl;
  document.getElementById("cfg-client-id").value = state.config.clientId;
  document.getElementById("cfg-client-secret").value = state.config.clientSecret;
  document.getElementById("cfg-redirect-uri").value = state.config.redirectUri;
  document.getElementById("cfg-scopes").value = state.config.scopes;
  document.getElementById("cfg-api-key").value = state.config.apiKey;

  // Token displays
  document.getElementById("display-access-token").value = state.tokens.accessToken;
  document.getElementById("display-id-token").value = state.tokens.idToken;
  document.getElementById("display-refresh-token").value = state.tokens.refreshToken;

  // DCR default payload
  const dcrEditor = document.getElementById("dcr-payload-editor");
  if (!dcrEditor.value) {
    dcrEditor.value = JSON.stringify({
      client_name: "Apigee OIDC Tester Client",
      redirect_uris: [state.config.redirectUri],
      grant_types: ["authorization_code", "refresh_token", "client_credentials"],
      response_types: ["code"],
      scope: state.config.scopes
    }, null, 2);
  }

  renderEndpointsList();
  selectEndpoint(state.selectedEndpointId);
  decodeAndRenderTokens();
  updateWorkflowState();
}

function initUI() {
  // Stepper Bar Navigation clicks
  document.querySelectorAll(".step-item").forEach(item => {
    item.addEventListener("click", () => {
      const step = parseInt(item.getAttribute("data-step"), 10);
      if (step === 2 && !state.config.clientId) {
        showToast("Please register a client first (Step 1)", "warning");
        switchStep(1);
        return;
      }
      switchStep(step);
    });
  });

  // Step Advancement buttons
  document.getElementById("btn-goto-step-2")?.addEventListener("click", () => switchStep(2));
  document.getElementById("btn-back-to-step-1")?.addEventListener("click", () => switchStep(1));
  document.getElementById("btn-goto-step-3")?.addEventListener("click", () => switchStep(3));
  document.getElementById("btn-back-to-step-2")?.addEventListener("click", () => switchStep(2));

  // Change / Re-register button
  document.getElementById("btn-re-register")?.addEventListener("click", () => {
    document.getElementById("client-registration-workarea").style.display = "block";
    document.getElementById("client-registered-banner").style.display = "none";
  });

  // Registration Mode Tabs (DCR vs CIMD vs Manual)
  document.querySelectorAll(".reg-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".reg-mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.getAttribute("data-reg");
      document.querySelectorAll(".reg-pane").forEach(p => p.classList.remove("active"));
      document.getElementById(`pane-reg-${mode}`).classList.add("active");
    });
  });

  // Toggle DCR Payload JSON
  document.getElementById("btn-toggle-dcr-payload")?.addEventListener("click", () => {
    const container = document.getElementById("dcr-payload-container");
    container.style.display = container.style.display === "none" ? "block" : "none";
  });

  // CIMD Handlers
  document.getElementById("btn-sample-cimd")?.addEventListener("click", () => {
    document.getElementById("cimd-url-input").value = "https://raw.githubusercontent.com/oauth-samples/client-identity/main/client.json";
  });

  document.getElementById("btn-activate-cimd")?.addEventListener("click", () => {
    const url = document.getElementById("cimd-url-input").value.trim();
    if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
      showToast("Please enter a valid HTTP(S) URL for the CIMD document", "error");
      return;
    }
    state.config.clientId = url;
    document.getElementById("cfg-client-id").value = url;
    autoSaveConfig(true);
    updateUI();
    showToast("CIMD client configured! Proceeding to Step 2.", "success");
    setTimeout(() => switchStep(2), 500);
  });

  // Manual Credentials Handler
  document.getElementById("btn-apply-manual-client")?.addEventListener("click", () => {
    const cid = document.getElementById("manual-client-id").value.trim();
    const csec = document.getElementById("manual-client-secret").value.trim();
    if (!cid) {
      showToast("Please enter a Client ID", "error");
      return;
    }
    state.config.clientId = cid;
    state.config.clientSecret = csec;
    document.getElementById("cfg-client-id").value = cid;
    document.getElementById("cfg-client-secret").value = csec;
    autoSaveConfig(true);
    updateUI();
    showToast("Credentials applied! Proceeding to Step 2.", "success");
    setTimeout(() => switchStep(2), 500);
  });

  // Reset & Clear Handlers
  document.getElementById("btn-clear-client")?.addEventListener("click", clearClientRegistration);
  document.getElementById("btn-reset-state")?.addEventListener("click", clearAllState);

  // Auto-save on Config Inputs
  ["cfg-server-url", "cfg-client-id", "cfg-client-secret", "cfg-scopes", "cfg-api-key"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => autoSaveConfig(true));
      el.addEventListener("change", () => autoSaveConfig(true));
    }
  });

  // Step 3 Subtabs (Tester vs Claims)
  document.getElementById("subtab-btn-tester")?.addEventListener("click", () => {
    document.getElementById("subtab-btn-tester").classList.add("active");
    document.getElementById("subtab-btn-claims").classList.remove("active");
    document.getElementById("tester-workspace").style.display = "block";
    document.getElementById("claims-workspace").style.display = "none";
  });

  document.getElementById("subtab-btn-claims")?.addEventListener("click", () => {
    document.getElementById("subtab-btn-claims").classList.add("active");
    document.getElementById("subtab-btn-tester").classList.remove("active");
    document.getElementById("tester-workspace").style.display = "none";
    document.getElementById("claims-workspace").style.display = "block";
  });

  // Subtabs (Headers vs Body inside Tester)
  document.querySelectorAll(".subtab-btn[data-subtab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".subtab-btn[data-subtab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const target = btn.getAttribute("data-subtab");
      document.querySelectorAll(".subtab-content").forEach(c => c.style.display = "none");
      document.getElementById(target).style.display = "block";
    });
  });

  // Discovery Button
  document.getElementById("btn-test-discovery").addEventListener("click", discoverMetadata);

  // Authentication Buttons
  document.getElementById("btn-start-pkce-login").addEventListener("click", startPKCELogin);
  document.getElementById("btn-client-credentials").addEventListener("click", getClientCredentialsToken);
  document.getElementById("btn-refresh-token").addEventListener("click", refreshAccessToken);
  document.getElementById("btn-revoke-token").addEventListener("click", revokeToken);
  document.getElementById("btn-introspect-token").addEventListener("click", introspectToken);
  document.getElementById("btn-copy-access-token").addEventListener("click", () => {
    if (state.tokens.accessToken) {
      navigator.clipboard.writeText(state.tokens.accessToken);
      showToast("Access token copied to clipboard!", "success");
    }
  });

  // DCR & UserInfo Buttons
  document.getElementById("btn-execute-dcr").addEventListener("click", executeDCR);
  document.getElementById("btn-fetch-userinfo").addEventListener("click", fetchUserInfo);

  // Endpoint Tester Buttons
  document.getElementById("btn-send-request").addEventListener("click", sendApiTestRequest);
  document.getElementById("btn-add-custom-endpoint").addEventListener("click", addCustomEndpoint);

  // Self-Service User Flow Links
  document.getElementById("btn-action-register")?.addEventListener("click", () => {
    const url = `${state.config.serverUrl}/register-user?client_id=${encodeURIComponent(state.config.clientId)}&redirect_uri=${encodeURIComponent(state.config.redirectUri)}`;
    window.open(url, "_blank");
  });

  document.getElementById("btn-action-mfa")?.addEventListener("click", () => {
    const claims = decodeJwt(state.tokens.idToken || state.tokens.accessToken);
    const emailParam = claims?.email ? `&email=${encodeURIComponent(claims.email)}` : "";
    const url = `${state.config.serverUrl}/mfa-setup?client_id=${encodeURIComponent(state.config.clientId)}&redirect_uri=${encodeURIComponent(state.config.redirectUri)}${emailParam}`;
    window.open(url, "_blank");
  });

  document.getElementById("btn-action-reset")?.addEventListener("click", () => {
    const claims = decodeJwt(state.tokens.idToken || state.tokens.accessToken);
    const emailParam = claims?.email ? `&email=${encodeURIComponent(claims.email)}` : "";
    const url = `${state.config.serverUrl}/reset-password?client_id=${encodeURIComponent(state.config.clientId)}&redirect_uri=${encodeURIComponent(state.config.redirectUri)}${emailParam}`;
    window.open(url, "_blank");
  });

  document.getElementById("btn-action-delete")?.addEventListener("click", () => {
    const claims = decodeJwt(state.tokens.idToken || state.tokens.accessToken);
    const emailParam = claims?.email ? `&email=${encodeURIComponent(claims.email)}` : "";
    const url = `${state.config.serverUrl}/delete-account?client_id=${encodeURIComponent(state.config.clientId)}&redirect_uri=${encodeURIComponent(state.config.redirectUri)}${emailParam}`;
    window.open(url, "_blank");
  });
}

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

