import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { AuthSession, BreadcrumbItem, DriveFile } from "./types";
import { createFolder, deleteFile, downloadFile, listFolder, renameFile, uploadToDrive } from "./lib/drive";
import { fetchGoogleUserInfo } from "./lib/auth";
import {
    ALL_RATIOS,
    cropImage,
    cropVideo,
    makeConvertedName,
    type AspectRatio,
} from "./lib/convert";
import CropEditor from "./CropEditor";

type Screen = "login" | "home" | "browser";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET;
const ROOT_FOLDER_ID = import.meta.env.VITE_ROOT_FOLDER_ID;
const ROOT_FOLDER_NAME = import.meta.env.VITE_ROOT_FOLDER_NAME || "Kořen";
const ALLOWED_DOMAIN = (import.meta.env.VITE_ALLOWED_DOMAIN || "").trim().toLowerCase();
const ALLOWED_EMAILS = (import.meta.env.VITE_ALLOWED_EMAILS || "")
    .split(",")
    .map((item: string) => item.trim().toLowerCase())
    .filter(Boolean);

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive openid email profile";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try { return JSON.stringify(error); }
    catch { return "Operace selhala."; }
}

function decodeJwtPayload<T = Record<string, unknown>>(token: string): T | null {
    try {
        const parts = token.split(".");
        if (parts.length < 2) return null;
        const payload = parts[1]
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
        return JSON.parse(atob(payload)) as T;
    } catch { return null; }
}

function formatMime(mime: string) {
    const map: Record<string, string> = {
        "application/vnd.google-apps.folder": "Složka",
        "image/jpeg": "JPEG", "image/png": "PNG", "image/gif": "GIF",
        "image/webp": "WebP", "video/mp4": "MP4", "video/quicktime": "MOV",
        "video/webm": "WebM", "application/pdf": "PDF",
    };
    return map[mime] || mime.split("/").pop()?.toUpperCase() || mime;
}

function isMedia(mime: string) {
    return mime.startsWith("image/") || mime.startsWith("video/");
}

function isFolder(mime: string) {
    return mime === "application/vnd.google-apps.folder";
}

function triggerBrowserDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Web OAuth helpers ──

function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function exchangeCodeForToken(code: string, codeVerifier: string, redirectUri: string): Promise<{ access_token: string; id_token?: string }> {
    const body = new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code_verifier: codeVerifier,
    });
    // Include client_secret if available (for confidential clients)
    if (GOOGLE_CLIENT_SECRET) {
        body.set("client_secret", GOOGLE_CLIENT_SECRET);
    }
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Token exchange selhal: ${response.status} ${text}`);
    }
    return await response.json();
}

// ── SVG Icons ──

const Icons = {
    login: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>,
    home: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
    logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
    folder: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
    upload: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    refresh: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>,
    newFolder: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>,
    uploadSm: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
    trash: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    trashLg: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
    crop: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>,
    cropLg: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"/><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"/></svg>,
    rename: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>,
    renameLg: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>,
    download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    eye: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
    close: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    folderFill: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>,
    file: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
    emptyFolder: <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.3"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
};

export default function App() {
    const [screen, setScreen] = useState<Screen>("login");
    const [accessToken, setAccessToken] = useState("");
    const [userEmail, setUserEmail] = useState("");
    const [files, setFiles] = useState<DriveFile[]>([]);
    const [currentFolderId, setCurrentFolderId] = useState(ROOT_FOLDER_ID || "");
    const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
        { id: ROOT_FOLDER_ID || "", name: ROOT_FOLDER_NAME }
    ]);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");
    const [loginWaiting, setLoginWaiting] = useState(false);
    const [pendingUploadPicker, setPendingUploadPicker] = useState(false);

    // New folder dialog
    const [newFolderDialog, setNewFolderDialog] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");

    // Selection
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Delete dialog
    const [deleteDialog, setDeleteDialog] = useState(false);

    // Rename dialog
    const [renameDialog, setRenameDialog] = useState(false);
    const [renameTarget, setRenameTarget] = useState<DriveFile | null>(null);
    const [renameName, setRenameName] = useState("");

    // Convert dialog (step 1: select ratios, step 2: crop editor)
    const [convertDialog, setConvertDialog] = useState(false);
    const [convertFile, setConvertFile] = useState<DriveFile | null>(null);
    const [convertRatios, setConvertRatios] = useState<Set<AspectRatio>>(new Set());
    const [convertProgress, setConvertProgress] = useState("");
    // Crop editor (step 2)
    const [cropEditorOpen, setCropEditorOpen] = useState(false);
    const [cropImageUrl, setCropImageUrl] = useState("");
    const [cropNatW, setCropNatW] = useState(0);
    const [cropNatH, setCropNatH] = useState(0);
    const [cropFileData, setCropFileData] = useState<ArrayBuffer | null>(null);

    // Preview
    const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const folderCache = useRef<Map<string, { data: DriveFile[]; ts: number }>>(new Map());
    const CACHE_TTL = 30_000;

    const envError = useMemo(() => {
        if (!GOOGLE_CLIENT_ID) return "Chybí VITE_GOOGLE_CLIENT_ID v .env";
        if (!ROOT_FOLDER_ID) return "Chybí VITE_ROOT_FOLDER_ID v .env";
        return "";
    }, []);

    // ── Auth ──

    function isAllowedEmail(email: string) {
        const normalized = email.trim().toLowerCase();
        const domainOk = !ALLOWED_DOMAIN || normalized.endsWith(`@${ALLOWED_DOMAIN}`);
        const listOk = ALLOWED_EMAILS.length === 0 || ALLOWED_EMAILS.includes(normalized);
        return domainOk && listOk;
    }

    async function completeLogin(token: string) {
        const userInfo = await fetchGoogleUserInfo(token);
        const email = userInfo.email?.trim().toLowerCase();
        if (!email) throw new Error("Nepodařilo se získat email z Google účtu.");
        if (!isAllowedEmail(email)) {
            throw new Error("Tento účet nemá oprávnění aplikaci používat.");
        }
        setAccessToken(token);
        setUserEmail(email);
        setScreen("home");
        setMessage("Přihlášení proběhlo.");
    }

    // Tauri OAuth (external browser + localhost TCP listener)
    async function handleLoginTauri() {
        const { invoke } = await import("@tauri-apps/api/core");
        setLoginWaiting(true);
        const session = await invoke<AuthSession>("start_google_oauth", {
            clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET
        });
        setLoginWaiting(false);
        if (session.idToken) {
            const payload = decodeJwtPayload<{ email?: string }>(session.idToken);
            const email = payload?.email?.trim().toLowerCase();
            if (email && isAllowedEmail(email)) {
                setAccessToken(session.accessToken);
                setUserEmail(email);
                setScreen("home");
                setMessage("Přihlášení proběhlo.");
                return;
            }
        }
        await completeLogin(session.accessToken);
    }

    // Web OAuth (PKCE redirect flow)
    async function handleLoginWeb() {
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = await generateCodeChallenge(codeVerifier);
        sessionStorage.setItem("oauth_code_verifier", codeVerifier);

        const redirectUri = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: DRIVE_SCOPES,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            access_type: "online",
            prompt: "consent",
        });
        window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    async function handleLogin() {
        if (envError) { setMessage(envError); return; }
        setLoading(true); setMessage("");
        try {
            if (IS_TAURI) {
                await handleLoginTauri();
            } else {
                await handleLoginWeb();
            }
        } catch (error) {
            setAccessToken(""); setUserEmail(""); setScreen("login");
            setMessage(getErrorMessage(error));
        }
        finally { setLoading(false); setLoginWaiting(false); }
    }

    // Handle OAuth redirect callback (web mode)
    useEffect(() => {
        if (IS_TAURI) return;
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) return;

        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);

        const codeVerifier = sessionStorage.getItem("oauth_code_verifier");
        if (!codeVerifier) {
            setMessage("Chybí code_verifier — zkuste se přihlásit znovu.");
            return;
        }
        sessionStorage.removeItem("oauth_code_verifier");

        const redirectUri = window.location.origin + window.location.pathname;
        setLoading(true); setMessage("");

        exchangeCodeForToken(code, codeVerifier, redirectUri)
            .then(tokenData => completeLogin(tokenData.access_token))
            .catch(error => {
                setMessage(getErrorMessage(error));
                setAccessToken(""); setUserEmail(""); setScreen("login");
            })
            .finally(() => setLoading(false));
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    function handleLogout() {
        setAccessToken(""); setUserEmail(""); setFiles([]);
        setCurrentFolderId(ROOT_FOLDER_ID || "");
        setBreadcrumbs([{ id: ROOT_FOLDER_ID || "", name: ROOT_FOLDER_NAME }]);
        setSelected(new Set());
        setScreen("login"); setMessage("Odhlášeno.");
    }

    // ── Folder navigation ──

    const loadFolder = useCallback(async (folderId: string, nextBreadcrumbs: BreadcrumbItem[], skipCache = false) => {
        if (!skipCache) {
            const cached = folderCache.current.get(folderId);
            if (cached && Date.now() - cached.ts < CACHE_TTL) {
                setCurrentFolderId(folderId);
                setFiles(cached.data);
                setBreadcrumbs(nextBreadcrumbs);
                setSelected(new Set());
                setScreen("browser");
                return;
            }
        }
        const data = await listFolder(accessToken, folderId);
        folderCache.current.set(folderId, { data, ts: Date.now() });
        setCurrentFolderId(folderId);
        setFiles(data);
        setBreadcrumbs(nextBreadcrumbs);
        setSelected(new Set());
        setScreen("browser");
    }, [accessToken]);

    async function openRootFolder(openUploadPicker = false) {
        const trail = [{ id: ROOT_FOLDER_ID, name: ROOT_FOLDER_NAME }];
        setPendingUploadPicker(openUploadPicker);
        await loadFolder(ROOT_FOLDER_ID, trail);
    }

    async function handleOpenLibrary() {
        setLoading(true); setMessage("");
        try { await openRootFolder(false); }
        catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleUploadFromHome() {
        setLoading(true); setMessage("");
        try { await openRootFolder(true); }
        catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleFolderClick(file: DriveFile) {
        if (!isFolder(file.mimeType)) return;
        setLoading(true); setMessage("");
        try {
            await loadFolder(file.id, [...breadcrumbs, { id: file.id, name: file.name }]);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleBreadcrumbClick(index: number) {
        const nextTrail = breadcrumbs.slice(0, index + 1);
        setLoading(true); setMessage("");
        try { await loadFolder(nextTrail[nextTrail.length - 1].id, nextTrail); }
        catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleRefresh() {
        setLoading(true); setMessage("");
        try { await loadFolder(currentFolderId, breadcrumbs, true); }
        catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    // ── Create folder ──

    function handleCreateFolder() {
        setNewFolderName(""); setNewFolderDialog(true);
    }

    async function handleCreateFolderConfirm() {
        const name = newFolderName.trim();
        if (!name) return;
        setNewFolderDialog(false); setLoading(true); setMessage("");
        try {
            await createFolder(accessToken, currentFolderId, name);
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            setMessage(`Složka "${name}" vytvořena.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    // ── Upload ──

    async function handleFileChange(file?: File | null) {
        if (!file) return;
        setLoading(true); setMessage("");
        try {
            await uploadToDrive(accessToken, file, currentFolderId);
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            setMessage(`"${file.name}" nahráno.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    // ── Selection ──

    function toggleSelect(fileId: string) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
            return next;
        });
    }

    function toggleSelectAll() {
        setSelected(prev => prev.size === files.length ? new Set() : new Set(files.map(f => f.id)));
    }

    // ── Delete ──

    function handleDeleteSelected() {
        if (selected.size === 0) return;
        setDeleteDialog(true);
    }

    async function handleDeleteConfirm() {
        setDeleteDialog(false); setLoading(true); setMessage("");
        const ids = [...selected];
        try {
            await Promise.all(ids.map(id => deleteFile(accessToken, id)));
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            const n = ids.length;
            setMessage(`Smazáno ${n} ${n === 1 ? "položka" : n < 5 ? "položky" : "položek"}.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleDeleteSingle(file: DriveFile) {
        setLoading(true); setMessage("");
        try {
            await deleteFile(accessToken, file.id);
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            setMessage(`"${file.name}" smazáno.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    // ── Rename ──

    function openRenameDialog(file: DriveFile) {
        setRenameTarget(file);
        setRenameName(file.name);
        setRenameDialog(true);
    }

    async function handleRenameConfirm() {
        const name = renameName.trim();
        if (!name || !renameTarget || name === renameTarget.name) {
            setRenameDialog(false);
            return;
        }
        setRenameDialog(false); setLoading(true); setMessage("");
        try {
            await renameFile(accessToken, renameTarget.id, name);
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            setMessage(`Přejmenováno na "${name}".`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    // ── Download to device ──

    async function handleDownload(file: DriveFile) {
        setLoading(true); setMessage("");
        try {
            const data = await downloadFile(accessToken, file.id);
            const blob = new Blob([data], { type: file.mimeType });
            triggerBrowserDownload(blob, file.name);
            setMessage(`"${file.name}" staženo.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    // ── Preview ──

    async function openPreview(file: DriveFile) {
        setPreviewFile(file);
        setPreviewUrl("");
        setPreviewLoading(true);
        try {
            const data = await downloadFile(accessToken, file.id);
            const blob = new Blob([data], { type: file.mimeType });
            setPreviewUrl(URL.createObjectURL(blob));
        } catch (error) {
            setMessage(getErrorMessage(error));
            setPreviewFile(null);
        } finally {
            setPreviewLoading(false);
        }
    }

    function closePreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewFile(null);
        setPreviewUrl("");
    }

    // ── Convert (step 1: ratio selection, step 2: interactive crop) ──

    function openConvertDialog(file: DriveFile) {
        setConvertFile(file);
        setConvertRatios(new Set());
        setConvertProgress("");
        setConvertDialog(true);
    }

    function toggleConvertRatio(r: AspectRatio) {
        setConvertRatios(prev => {
            const next = new Set(prev);
            if (next.has(r)) next.delete(r); else next.add(r);
            return next;
        });
    }

    function toggleAllRatios() {
        setConvertRatios(prev =>
            prev.size === ALL_RATIOS.length ? new Set() : new Set(ALL_RATIOS)
        );
    }

    async function handleConvertNext() {
        if (!convertFile || convertRatios.size === 0) return;
        const file = convertFile;
        const isImage = file.mimeType.startsWith("image/");

        setConvertDialog(false);
        setLoading(true); setMessage("");

        try {
            setConvertProgress("Stahuji soubor...");
            const data = await downloadFile(accessToken, file.id);
            setCropFileData(data);

            if (isImage) {
                const blob = new Blob([data], { type: file.mimeType });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error("Nelze načíst obrázek."));
                    img.src = url;
                });
                setCropImageUrl(url);
                setCropNatW(img.naturalWidth);
                setCropNatH(img.naturalHeight);
                setConvertProgress("");
                setLoading(false);
                setCropEditorOpen(true);
            } else {
                await processConvert(file, [...convertRatios], data, {});
            }
        } catch (error) {
            setConvertProgress("");
            setMessage(getErrorMessage(error));
            setLoading(false);
        }
    }

    async function handleCropConfirm(positions: Record<AspectRatio, { panX: number; panY: number }>) {
        setCropEditorOpen(false);
        if (cropImageUrl) URL.revokeObjectURL(cropImageUrl);
        setCropImageUrl("");

        if (!convertFile || !cropFileData) return;
        setLoading(true); setMessage("");
        await processConvert(convertFile, [...convertRatios], cropFileData, positions);
    }

    function handleCropCancel() {
        setCropEditorOpen(false);
        if (cropImageUrl) URL.revokeObjectURL(cropImageUrl);
        setCropImageUrl("");
        setCropFileData(null);
    }

    async function processConvert(
        file: DriveFile,
        ratios: AspectRatio[],
        data: ArrayBuffer,
        positions: Partial<Record<AspectRatio, { panX: number; panY: number }>>
    ) {
        const isVid = file.mimeType.startsWith("video/");
        try {
            for (let i = 0; i < ratios.length; i++) {
                const ratio = ratios[i];
                const pan = positions[ratio] ?? { panX: 0.5, panY: 0.5 };
                setConvertProgress(`Konvertuji ${ratio} (${i + 1}/${ratios.length})...`);
                const blob = isVid
                    ? await cropVideo(data, file.mimeType, ratio, pan.panX, pan.panY)
                    : await cropImage(data, file.mimeType, ratio, pan.panX, pan.panY);
                const outName = makeConvertedName(file.name, ratio, isVid);
                const outFile = new File([blob], outName, { type: blob.type });
                setConvertProgress(`Nahrávám ${outName}...`);
                await uploadToDrive(accessToken, outFile, currentFolderId);
            }
            setConvertProgress("");
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            setMessage(`Konverze dokončena — ${ratios.length} ${ratios.length === 1 ? "varianta" : ratios.length < 5 ? "varianty" : "variant"} nahráno.`);
        } catch (error) {
            setConvertProgress("");
            setMessage(getErrorMessage(error));
        } finally {
            setLoading(false);
            setCropFileData(null);
        }
    }

    // ── Effects ──

    useEffect(() => {
        if (screen === "browser" && pendingUploadPicker && fileInputRef.current) {
            fileInputRef.current.click();
            setPendingUploadPicker(false);
        }
    }, [screen, pendingUploadPicker]);

    // ── Derived ──

    const selectedFiles = files.filter(f => selected.has(f.id));
    const selectionHasFolders = selectedFiles.some(f => isFolder(f.mimeType));
    const selectionHasFiles = selectedFiles.some(f => !isFolder(f.mimeType));
    const selectedMediaFiles = selectedFiles.filter(f => isMedia(f.mimeType));

    function deleteDialogLabel() {
        const n = selected.size;
        if (selectionHasFolders && selectionHasFiles) return `${n} položek (složky i soubory)`;
        if (selectionHasFolders) return n === 1 ? "1 složku" : `${n} složek`;
        return n === 1 ? "1 soubor" : `${n} souborů`;
    }

    // ── Render ──

    return (
        <div className="app-shell">
            {/* ── Login ── */}
            {screen === "login" && (
                <div className="login-wrapper">
                    <div className="login-card">
                        {!loginWaiting ? (
                            <>
                                <div className="login-logo">CS</div>
                                <h1 className="login-title">Canto Silva</h1>
                                <p className="login-lead">Přihlaste se Google účtem pro přístup ke knihovně.</p>
                                <button className="btn btn-primary btn-lg" onClick={handleLogin} disabled={loading}>
                                    {Icons.login} Přihlásit se
                                </button>
                                {message && <p className="login-error">{message}</p>}
                                {(ALLOWED_DOMAIN || ALLOWED_EMAILS.length > 0) && (
                                    <div className="login-hint">
                                        {ALLOWED_DOMAIN && <span>Doména: {ALLOWED_DOMAIN}</span>}
                                        {ALLOWED_EMAILS.length > 0 && <span>Povoleno: {ALLOWED_EMAILS.join(", ")}</span>}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="login-waiting">
                                <div className="login-waiting-pulse" />
                                <h2>Čekám na přihlášení…</h2>
                                <p>Dokončete přihlášení v prohlížeči,<br />který se právě otevřel.</p>
                                <div className="login-waiting-dots">
                                    <span /><span /><span />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── Authenticated shell ── */}
            {screen !== "login" && (
                <div className="shell">
                    <header className="header">
                        <div className="header-left">
                            <div className="header-logo">CS</div>
                            <div>
                                <h1 className="header-title">Canto Silva</h1>
                                <p className="header-email">{userEmail}</p>
                            </div>
                        </div>
                        <div className="header-actions">
                            {screen === "browser" && (
                                <button className="btn btn-ghost" onClick={() => { setScreen("home"); setSelected(new Set()); }} disabled={loading}>
                                    {Icons.home} Domů
                                </button>
                            )}
                            <button className="btn btn-ghost" onClick={handleLogout} disabled={loading}>
                                {Icons.logout} Odhlásit
                            </button>
                        </div>
                    </header>

                    {/* ── Home ── */}
                    {screen === "home" && (
                        <div className="home-grid">
                            <button className="home-tile" onClick={handleOpenLibrary} disabled={loading}>
                                <div className="tile-icon">{Icons.folder}</div>
                                <span className="tile-title">Knihovna</span>
                                <span className="tile-desc">Procházet složky a soubory</span>
                            </button>
                            <button className="home-tile" onClick={handleUploadFromHome} disabled={loading}>
                                <div className="tile-icon">{Icons.upload}</div>
                                <span className="tile-title">Nahrát</span>
                                <span className="tile-desc">Vybrat fotku nebo video</span>
                            </button>
                        </div>
                    )}

                    {/* ── Browser ── */}
                    {screen === "browser" && (
                        <div className="browser">
                            <nav className="breadcrumbs">
                                {breadcrumbs.map((item, index) => (
                                    <span key={item.id} className="crumb-wrap">
                                        {index > 0 && <span className="crumb-sep">/</span>}
                                        <button
                                            className={`crumb ${index === breadcrumbs.length - 1 ? "crumb-active" : ""}`}
                                            onClick={() => handleBreadcrumbClick(index)}
                                            disabled={loading}
                                        >{item.name}</button>
                                    </span>
                                ))}
                            </nav>

                            <div className="toolbar">
                                <div className="toolbar-left">
                                    <button className="btn btn-secondary btn-sm" onClick={handleRefresh} disabled={loading}>
                                        {Icons.refresh} Obnovit
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={handleCreateFolder} disabled={loading}>
                                        {Icons.newFolder} Nová složka
                                    </button>
                                    <button className="btn btn-primary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={loading}>
                                        {Icons.uploadSm} Nahrát
                                    </button>
                                    <input
                                        ref={fileInputRef} type="file" accept="image/*,video/*"
                                        onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                                        style={{ display: "none" }}
                                    />
                                </div>

                                {selected.size > 0 && (
                                    <div className="toolbar-right">
                                        <span className="selection-badge">{selected.size} vybráno</span>
                                        {selectedMediaFiles.length === 1 && (
                                            <button className="btn btn-accent btn-sm" onClick={() => openConvertDialog(selectedMediaFiles[0])} disabled={loading}>
                                                {Icons.crop} Konvertovat
                                            </button>
                                        )}
                                        <button className="btn btn-danger btn-sm" onClick={handleDeleteSelected} disabled={loading}>
                                            {Icons.trash} Smazat
                                        </button>
                                        <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
                                            Zrušit výběr
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* File table */}
                            <div className="file-table">
                                {files.length > 0 && (
                                    <div className="file-table-head">
                                        <label className="checkbox-cell">
                                            <input type="checkbox" checked={files.length > 0 && selected.size === files.length} onChange={toggleSelectAll} />
                                        </label>
                                        <span className="col-name">Název</span>
                                        <span className="col-type">Typ</span>
                                        <span className="col-date">Upraveno</span>
                                        <span className="col-actions"></span>
                                    </div>
                                )}

                                {files.length === 0 ? (
                                    <div className="empty-state">
                                        {Icons.emptyFolder}
                                        <p>Tato složka je prázdná</p>
                                    </div>
                                ) : files.map((file) => {
                                    const isFld = isFolder(file.mimeType);
                                    const isSelected = selected.has(file.id);
                                    const canPreview = isMedia(file.mimeType);
                                    const canDownload = !isFld;
                                    const canConvert = isMedia(file.mimeType);

                                    return (
                                        <div className={`file-row ${isFld ? "file-row-folder" : ""} ${isSelected ? "file-row-selected" : ""}`} key={file.id}>
                                            <label className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(file.id)} />
                                            </label>

                                            <div
                                                className="col-name"
                                                onClick={() => {
                                                    if (isFld) handleFolderClick(file);
                                                    else if (canPreview) openPreview(file);
                                                }}
                                                style={{ cursor: (isFld || canPreview) ? "pointer" : "default" }}
                                            >
                                                <span className={`file-icon ${isFld ? "icon-folder" : "icon-file"}`}>
                                                    {isFld ? Icons.folderFill : Icons.file}
                                                </span>
                                                <span className="file-name-text">{file.name}</span>
                                            </div>

                                            <span className="col-type">{formatMime(file.mimeType)}</span>

                                            <span className="col-date">
                                                {file.modifiedTime
                                                    ? new Date(file.modifiedTime).toLocaleDateString("cs-CZ", { day: "numeric", month: "short", year: "numeric" })
                                                    : "—"}
                                            </span>

                                            <div className="col-actions">
                                                {canPreview && (
                                                    <button className="btn-icon" title="Náhled" onClick={() => openPreview(file)} disabled={loading}>
                                                        {Icons.eye}
                                                    </button>
                                                )}
                                                <button className="btn-icon" title="Přejmenovat" onClick={() => openRenameDialog(file)} disabled={loading}>
                                                    {Icons.rename}
                                                </button>
                                                {canDownload && (
                                                    <button className="btn-icon" title="Stáhnout" onClick={() => handleDownload(file)} disabled={loading}>
                                                        {Icons.download}
                                                    </button>
                                                )}
                                                {canConvert && (
                                                    <button className="btn-icon btn-icon-accent" title="Konvertovat" onClick={() => openConvertDialog(file)} disabled={loading}>
                                                        {Icons.crop}
                                                    </button>
                                                )}
                                                <button className="btn-icon btn-icon-danger" title="Smazat" onClick={() => handleDeleteSingle(file)} disabled={loading}>
                                                    {Icons.trash}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {files.length > 0 && (
                                <div className="file-count">{files.length} {files.length === 1 ? "položka" : files.length < 5 ? "položky" : "položek"}</div>
                            )}
                        </div>
                    )}

                    {/* Toast */}
                    {(loading || message) && (
                        <div className={`toast ${loading ? "toast-loading" : ""}`}>
                            {loading && <span className="spinner" />}
                            <span>{loading ? (convertProgress || "Probíhá akce…") : message}</span>
                        </div>
                    )}
                </div>
            )}

            {/* ── New folder dialog ── */}
            {newFolderDialog && (
                <div className="overlay" onClick={() => setNewFolderDialog(false)}>
                    <div className="dialog" onClick={(e) => e.stopPropagation()}>
                        <h2>Nová složka</h2>
                        <input
                            className="dialog-input" type="text" placeholder="Název složky"
                            value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleCreateFolderConfirm();
                                if (e.key === "Escape") setNewFolderDialog(false);
                            }}
                            autoFocus
                        />
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setNewFolderDialog(false)}>Zrušit</button>
                            <button className="btn btn-primary" onClick={handleCreateFolderConfirm} disabled={!newFolderName.trim()}>Vytvořit</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Rename dialog ── */}
            {renameDialog && renameTarget && (
                <div className="overlay" onClick={() => setRenameDialog(false)}>
                    <div className="dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-icon-accent">{Icons.renameLg}</div>
                        <h2>Přejmenovat</h2>
                        <input
                            className="dialog-input" type="text" placeholder="Nový název"
                            value={renameName}
                            onChange={(e) => setRenameName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameConfirm();
                                if (e.key === "Escape") setRenameDialog(false);
                            }}
                            autoFocus
                            onFocus={(e) => {
                                const dot = renameName.lastIndexOf(".");
                                if (dot > 0) e.target.setSelectionRange(0, dot);
                                else e.target.select();
                            }}
                        />
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setRenameDialog(false)}>Zrušit</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleRenameConfirm}
                                disabled={!renameName.trim() || renameName.trim() === renameTarget.name}
                            >Přejmenovat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Delete dialog ── */}
            {deleteDialog && (
                <div className="overlay" onClick={() => setDeleteDialog(false)}>
                    <div className="dialog dialog-danger" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-icon-danger">{Icons.trashLg}</div>
                        <h2>Smazat {deleteDialogLabel()}?</h2>
                        <p className="dialog-desc">Tuto akci nelze vrátit zpět. Soubory budou trvale odstraněny z Google Disku.</p>
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setDeleteDialog(false)}>Zrušit</button>
                            <button className="btn btn-danger" onClick={handleDeleteConfirm}>Smazat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Convert dialog ── */}
            {convertDialog && convertFile && (
                <div className="overlay" onClick={() => setConvertDialog(false)}>
                    <div className="dialog dialog-convert" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-icon-accent">{Icons.cropLg}</div>
                        <h2>Konvertovat</h2>
                        <p className="dialog-desc">
                            <strong>{convertFile.name}</strong><br />
                            Vyber poměry stran. Výsledky se uloží do stejné složky.
                        </p>
                        <div className="ratio-grid">
                            {ALL_RATIOS.map((r) => (
                                <button
                                    key={r}
                                    className={`ratio-card ${convertRatios.has(r) ? "ratio-card-active" : ""}`}
                                    onClick={() => toggleConvertRatio(r)}
                                >
                                    <div className={`ratio-preview ratio-preview-${r.replace(":", "x")}`} />
                                    <span className="ratio-label">{r}</span>
                                </button>
                            ))}
                        </div>
                        <label className="select-all-check">
                            <input type="checkbox" checked={convertRatios.size === ALL_RATIOS.length} onChange={toggleAllRatios} />
                            <span>Vybrat vše</span>
                        </label>
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setConvertDialog(false)}>Zrušit</button>
                            <button className="btn btn-primary" onClick={handleConvertNext} disabled={convertRatios.size === 0}>
                                Další {convertRatios.size > 0 ? `(${convertRatios.size})` : ""}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Crop editor ── */}
            {cropEditorOpen && convertFile && (
                <CropEditor
                    imageUrl={cropImageUrl}
                    naturalWidth={cropNatW}
                    naturalHeight={cropNatH}
                    ratios={[...convertRatios]}
                    onConfirm={handleCropConfirm}
                    onCancel={handleCropCancel}
                />
            )}

            {/* ── Preview modal ── */}
            {previewFile && (
                <div className="preview-overlay" onClick={closePreview}>
                    <button className="preview-close" onClick={closePreview} title="Zavřít">
                        {Icons.close}
                    </button>

                    <div className="preview-header">
                        <span className="preview-filename">{previewFile.name}</span>
                        <button
                            className="btn btn-ghost btn-sm preview-download-btn"
                            onClick={(e) => { e.stopPropagation(); handleDownload(previewFile); }}
                        >
                            {Icons.download} Stáhnout
                        </button>
                    </div>

                    <div className="preview-content" onClick={(e) => e.stopPropagation()}>
                        {previewLoading && (
                            <div className="preview-loading">
                                <span className="spinner spinner-lg" />
                                <span>Načítám náhled…</span>
                            </div>
                        )}
                        {previewUrl && previewFile.mimeType.startsWith("image/") && (
                            <img className="preview-media" src={previewUrl} alt={previewFile.name} />
                        )}
                        {previewUrl && previewFile.mimeType.startsWith("video/") && (
                            <video className="preview-media" src={previewUrl} controls autoPlay />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
