/**
 * Canva Connect API integration.
 * Uses Firebase Cloud Functions as backend proxy for OAuth + API calls.
 */

const CANVA_CLIENT_ID = "OC-AZ1zT6lLCKyQ";
const CANVA_AUTH_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_SCOPES = "asset:read asset:write design:content:read design:content:write";

const PROXY_BASE = "https://canto-canva-proxy.holy-leaf-3952.workers.dev";

// ── PKCE helpers ──

function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const hash = await sha256(verifier);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Token storage ──

const TOKEN_KEY = "canva_tokens";
const VERIFIER_KEY = "canva_code_verifier";
const STATE_KEY = "canva_oauth_state";
const PENDING_KEY = "canva_pending_action";

export type CanvaTokens = {
    access_token: string;
    refresh_token: string;
    expires_at: number;
};

export type PendingCanvaAction = {
    fileId: string;
    fileName: string;
    mimeType: string;
    format: string;
    width: number;
    height: number;
};

export function getCanvaTokens(): CanvaTokens | null {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
}

function saveCanvaTokens(tokens: CanvaTokens): void {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearCanvaTokens(): void {
    localStorage.removeItem(TOKEN_KEY);
}

export function savePendingAction(action: PendingCanvaAction): void {
    localStorage.setItem(PENDING_KEY, JSON.stringify(action));
}

export function getPendingAction(): PendingCanvaAction | null {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    localStorage.removeItem(PENDING_KEY);
    try { return JSON.parse(raw); }
    catch { return null; }
}

// ── OAuth flow ──

export async function startCanvaAuth(redirectUri: string): Promise<void> {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = crypto.randomUUID();

    localStorage.setItem(VERIFIER_KEY, verifier);
    localStorage.setItem(STATE_KEY, state);

    const params = new URLSearchParams({
        code_challenge: challenge,
        code_challenge_method: "s256",
        scope: CANVA_SCOPES,
        response_type: "code",
        client_id: CANVA_CLIENT_ID,
        redirect_uri: redirectUri,
        state,
    });

    window.location.href = `${CANVA_AUTH_URL}?${params}`;
}

export async function handleCanvaCallback(
    code: string,
    state: string,
    redirectUri: string
): Promise<CanvaTokens> {
    const savedState = localStorage.getItem(STATE_KEY);
    const verifier = localStorage.getItem(VERIFIER_KEY);

    localStorage.removeItem(STATE_KEY);
    localStorage.removeItem(VERIFIER_KEY);

    if (state !== savedState) throw new Error("Invalid OAuth state");
    if (!verifier) throw new Error("Missing code verifier");

    const res = await fetch(`${PROXY_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token exchange failed: ${err}`);
    }

    const data = await res.json();
    const tokens: CanvaTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };

    saveCanvaTokens(tokens);
    return tokens;
}

// ── Refresh token ──

async function refreshAccessToken(tokens: CanvaTokens): Promise<CanvaTokens> {
    const res = await fetch(`${PROXY_BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
    });

    if (!res.ok) {
        clearCanvaTokens();
        throw new Error("Token refresh failed — please re-authorize Canva.");
    }

    const data = await res.json();
    const newTokens: CanvaTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || tokens.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    };

    saveCanvaTokens(newTokens);
    return newTokens;
}

async function getValidToken(): Promise<string> {
    let tokens = getCanvaTokens();
    if (!tokens) throw new Error("Not authenticated with Canva");

    // Refresh if expiring in less than 5 minutes
    if (tokens.expires_at < Date.now() + 5 * 60 * 1000) {
        tokens = await refreshAccessToken(tokens);
    }

    return tokens.access_token;
}

// ── Upload image asset ──

async function uploadAsset(
    imageData: ArrayBuffer,
    fileName: string,
    mimeType: string,
    onProgress?: (msg: string) => void
): Promise<string> {
    const token = await getValidToken();
    // Encode filename as base64 for the metadata header
    const nameBase64 = btoa(unescape(encodeURIComponent(fileName)));

    onProgress?.("Nahrávám obrázek do Canvy…");

    // Send image as raw binary — no base64 conversion needed
    const res = await fetch(`${PROXY_BASE}/upload-asset`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": mimeType === "image/png" ? "image/png" : "image/jpeg",
            "X-Asset-Name-Base64": nameBase64,
            "X-Asset-Mime-Type": mimeType,
        },
        body: imageData,
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Asset upload failed: ${err}`);
    }

    const data = await res.json();
    const jobId = data.job?.id;
    if (!jobId) throw new Error("No upload job ID returned");

    // Poll for completion
    onProgress?.("Čekám na zpracování obrázku…");
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const statusRes = await fetch(`${PROXY_BASE}/asset-status`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
            },
            body: JSON.stringify({ job_id: jobId }),
        });

        if (!statusRes.ok) continue;

        const statusData = await statusRes.json();
        if (statusData.job?.status === "success") {
            return statusData.job.asset.id;
        }
        if (statusData.job?.status === "failed") {
            throw new Error("Asset upload failed in Canva");
        }
    }

    throw new Error("Asset upload timed out");
}

// ── Create design with image ──

export async function createCanvaDesign(
    imageData: ArrayBuffer,
    fileName: string,
    mimeType: string,
    width: number,
    height: number,
    title: string,
    onProgress?: (msg: string) => void
): Promise<string> {
    const assetId = await uploadAsset(imageData, fileName, mimeType, onProgress);

    onProgress?.("Vytvářím návrh v Canvě…");
    const token = await getValidToken();

    const res = await fetch(`${PROXY_BASE}/create-design`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
            width,
            height,
            title,
            asset_id: assetId,
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Design creation failed: ${err}`);
    }

    const data = await res.json();
    const editUrl = data.design?.urls?.edit_url;
    if (!editUrl) throw new Error("No edit URL returned from Canva");

    return editUrl;
}
