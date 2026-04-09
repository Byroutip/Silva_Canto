import * as functions from "firebase-functions/v1";
import * as https from "https";
import * as http from "http";

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID || "";
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET || "";
const CANVA_API_HOST = "api.canva.com";
const CANVA_TOKEN_PATH = "/rest/v1/oauth/token";

const CORS_HEADERS: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Asset-Upload-Metadata",
    "Access-Control-Max-Age": "3600",
};

function setCors(res: functions.Response): void {
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.set(k, v);
}

// Simple HTTPS request helper
function httpsRequest(options: https.RequestOptions, body?: Buffer | string): Promise<{ status: number; data: unknown }> {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                try {
                    resolve({ status: res.statusCode || 200, data: JSON.parse(raw) });
                } catch {
                    resolve({ status: res.statusCode || 200, data: raw });
                }
            });
        });
        req.on("error", reject);
        if (body) req.write(body);
        req.end();
    });
}

// ── OAuth token exchange ──
export const canvaToken = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { code, code_verifier, redirect_uri } = req.body;
    if (!code || !code_verifier) { res.status(400).json({ error: "Missing code or code_verifier" }); return; }

    const basicAuth = Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "authorization_code", code, code_verifier, redirect_uri: redirect_uri || "" }).toString();

    const result = await httpsRequest({
        hostname: CANVA_API_HOST,
        path: CANVA_TOKEN_PATH,
        method: "POST",
        headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
        },
    }, body);

    res.status(result.status).json(result.data);
});

// ── Refresh token ──
export const canvaRefresh = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const { refresh_token } = req.body;
    if (!refresh_token) { res.status(400).json({ error: "Missing refresh_token" }); return; }

    const basicAuth = Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token }).toString();

    const result = await httpsRequest({
        hostname: CANVA_API_HOST,
        path: CANVA_TOKEN_PATH,
        method: "POST",
        headers: {
            "Authorization": `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
        },
    }, body);

    res.status(result.status).json(result.data);
});

// ── Upload asset ──
export const canvaUploadAsset = functions.runWith({ memory: "512MB", timeoutSeconds: 120 }).https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader) { res.status(401).json({ error: "Missing authorization" }); return; }

    const { name_base64, image_base64, mime_type } = req.body;
    if (!image_base64 || !name_base64) { res.status(400).json({ error: "Missing image_base64 or name_base64" }); return; }

    const imageBuffer = Buffer.from(image_base64, "base64");
    const metaHeader = JSON.stringify({ name_base64 });

    const result = await httpsRequest({
        hostname: CANVA_API_HOST,
        path: "/rest/v1/asset-uploads",
        method: "POST",
        headers: {
            "Authorization": authHeader,
            "Content-Type": mime_type || "image/jpeg",
            "Asset-Upload-Metadata": metaHeader,
            "Content-Length": imageBuffer.length,
        },
    }, imageBuffer);

    res.status(result.status).json(result.data);
});

// ── Get asset upload job status ──
export const canvaAssetStatus = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader) { res.status(401).json({ error: "Missing authorization" }); return; }

    const { job_id } = req.body;
    if (!job_id) { res.status(400).json({ error: "Missing job_id" }); return; }

    const result = await httpsRequest({
        hostname: CANVA_API_HOST,
        path: `/rest/v1/asset-uploads/${job_id}`,
        method: "GET",
        headers: { "Authorization": authHeader },
    });

    res.status(result.status).json(result.data);
});

// ── Create design ──
export const canvaCreateDesign = functions.https.onRequest(async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader) { res.status(401).json({ error: "Missing authorization" }); return; }

    const { width, height, title, asset_id } = req.body;

    const designBody: Record<string, unknown> = {
        design_type: { type: "custom", width, height },
        title: title || "Canto Silva design",
    };
    if (asset_id) designBody.asset_id = asset_id;

    const bodyStr = JSON.stringify(designBody);

    const result = await httpsRequest({
        hostname: CANVA_API_HOST,
        path: "/rest/v1/designs",
        method: "POST",
        headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(bodyStr),
        },
    }, bodyStr);

    res.status(result.status).json(result.data);
});

// Silence unused import warning
const _unusedHttp = http;
void _unusedHttp;
