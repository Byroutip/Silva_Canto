export async function fetchGoogleUserInfo(accessToken: string): Promise<{ email: string; name?: string; picture?: string }> {
    const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        method: "GET",
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Nepodařilo se načíst profil uživatele: ${response.status} ${text}`);
    }

    return await response.json();
}

export function isAuthorizedUser(email: string): boolean {
    const normalized = email.trim().toLowerCase();

    const allowedEmails = String(import.meta.env.VITE_ALLOWED_EMAILS ?? "")
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean);

    const allowedDomain = String(import.meta.env.VITE_ALLOWED_DOMAIN ?? "")
        .trim()
        .toLowerCase();

    // If no restrictions configured, allow everyone
    if (allowedEmails.length === 0 && !allowedDomain) {
        return true;
    }

    if (allowedEmails.includes(normalized)) {
        return true;
    }

    if (allowedDomain && normalized.endsWith(`@${allowedDomain}`)) {
        return true;
    }

    return false;
}
