import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type { BreadcrumbItem, DriveFile } from "./types";
import { createFolder, deleteFile, downloadFile, listFolder, renameFile, uploadToDrive } from "./lib/drive";
import {
    ALL_RATIOS,
    cropImage,
    cropVideo,
    makeConvertedName,
    type AspectRatio,
} from "./lib/convert";
import CropEditor from "./CropEditor";
import {
    loginWithGoogle,
    logoutFirebase,
    getAccessConfig,
    initAccessConfig,
    isEmailAllowed,
    isAdmin,
    addAllowedEmail,
    removeAllowedEmail,
    addAdmin,
    removeAdmin,
    db,
    type AccessConfig,
} from "./lib/firebase";
import {
    getUnindexedFiles,
    batchIndexImages,
    searchImages,
    type ImageIndexDoc,
} from "./lib/imageSearch";

type Screen = "login" | "home" | "browser";

const ROOT_FOLDER_ID = import.meta.env.VITE_ROOT_FOLDER_ID;
const ROOT_FOLDER_NAME = import.meta.env.VITE_ROOT_FOLDER_NAME || "Kořen";

function getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try { return JSON.stringify(error); }
    catch { return "Operace selhala."; }
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
    settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
    shield: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
    userPlus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>,
    users: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    searchLg: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
    spark: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>,
    key: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>,
    brain: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 3.5 2.5 6.5 6 7v6h2v-6c3.5-.5 6-3.5 6-7a7 7 0 0 0-7-7z"/><path d="M9 12a3 3 0 0 0 6 0"/></svg>,
    closeSm: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
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
    const [pendingUploadPicker, setPendingUploadPicker] = useState(false);

    // Access control
    const [accessConfig, setAccessConfig] = useState<AccessConfig | null>(null);
    const [userIsAdmin, setUserIsAdmin] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);

    // Admin panel
    const [adminPanelOpen, setAdminPanelOpen] = useState(false);
    const [newEmailInput, setNewEmailInput] = useState("");

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

    // Convert dialog
    const [convertDialog, setConvertDialog] = useState(false);
    const [convertFile, setConvertFile] = useState<DriveFile | null>(null);
    const [convertRatios, setConvertRatios] = useState<Set<AspectRatio>>(new Set());
    const [convertProgress, setConvertProgress] = useState("");
    // Crop editor
    const [cropEditorOpen, setCropEditorOpen] = useState(false);
    const [cropImageUrl, setCropImageUrl] = useState("");
    const [cropNatW, setCropNatW] = useState(0);
    const [cropNatH, setCropNatH] = useState(0);
    const [cropFileData, setCropFileData] = useState<ArrayBuffer | null>(null);

    // Preview
    const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
    const [previewUrl, setPreviewUrl] = useState("");
    const [previewLoading, setPreviewLoading] = useState(false);

    // AI Search
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<ImageIndexDoc[] | null>(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchScope, setSearchScope] = useState<"folder" | "global">("global");
    const [indexingProgress, setIndexingProgress] = useState<{ done: number; total: number } | null>(null);
    const [geminiKeyDialog, setGeminiKeyDialog] = useState(false);
    const [geminiKeyInput, setGeminiKeyInput] = useState("");

    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const folderCache = useRef<Map<string, { data: DriveFile[]; ts: number }>>(new Map());
    const CACHE_TTL = 30_000;
    const indexAbortRef = useRef<AbortController | null>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const envError = useMemo(() => {
        if (!ROOT_FOLDER_ID) return "Chybí VITE_ROOT_FOLDER_ID v .env";
        return "";
    }, []);

    // ── Auth ──

    async function handleLogin() {
        if (envError) { setMessage(envError); return; }
        setLoading(true); setMessage(""); setAccessDenied(false);
        try {
            const { user, accessToken: token } = await loginWithGoogle();
            const email = user.email?.toLowerCase() ?? "";
            if (!email) throw new Error("Nepodařilo se získat email.");

            // Init access config if first login ever
            await initAccessConfig(email);
            const config = await getAccessConfig();
            setAccessConfig(config);

            if (!isEmailAllowed(config, email)) {
                setAccessDenied(true);
                setUserEmail(email);
                await logoutFirebase();
                setLoading(false);
                return;
            }

            setAccessToken(token);
            setUserEmail(email);
            setUserIsAdmin(isAdmin(config, email));
            setScreen("home");
            setMessage("Přihlášení proběhlo.");
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    function handleLogout() {
        logoutFirebase();
        setAccessToken(""); setUserEmail(""); setFiles([]);
        setCurrentFolderId(ROOT_FOLDER_ID || "");
        setBreadcrumbs([{ id: ROOT_FOLDER_ID || "", name: ROOT_FOLDER_NAME }]);
        setSelected(new Set());
        setAccessDenied(false);
        setUserIsAdmin(false);
        setScreen("login"); setMessage("Odhlášeno.");
    }

    // ── Admin: manage emails ──

    async function refreshAccessConfig() {
        const config = await getAccessConfig();
        setAccessConfig(config);
        setUserIsAdmin(isAdmin(config, userEmail));
    }

    async function handleAddEmail() {
        const email = newEmailInput.trim().toLowerCase();
        if (!email || !email.includes("@")) return;
        setLoading(true);
        try {
            await addAllowedEmail(email);
            await refreshAccessConfig();
            setNewEmailInput("");
            setMessage(`${email} přidán.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleRemoveEmail(email: string) {
        setLoading(true);
        try {
            await removeAllowedEmail(email);
            await refreshAccessConfig();
            setMessage(`${email} odebrán.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
    }

    async function handleToggleAdmin(email: string, makeAdmin: boolean) {
        setLoading(true);
        try {
            if (makeAdmin) await addAdmin(email);
            else await removeAdmin(email);
            await refreshAccessConfig();
            setMessage(`${email} — admin ${makeAdmin ? "přidán" : "odebrán"}.`);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); }
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

    // ── Upload (multi-file + drag & drop) ──

    const [uploadProgress, setUploadProgress] = useState("");
    const [dragOver, setDragOver] = useState(false);

    async function uploadFiles(fileList: File[]) {
        if (fileList.length === 0) return;
        setLoading(true); setMessage("");
        const total = fileList.length;
        let uploaded = 0;
        let errors = 0;
        try {
            for (const file of fileList) {
                setUploadProgress(`Nahrávám ${file.name} (${uploaded + 1}/${total})…`);
                try {
                    await uploadToDrive(accessToken, file, currentFolderId);
                    uploaded++;
                } catch (err) {
                    console.warn(`Upload failed for ${file.name}:`, err);
                    errors++;
                }
            }
            folderCache.current.delete(currentFolderId);
            await loadFolder(currentFolderId, breadcrumbs);
            const msg = uploaded === 1
                ? `"${fileList[0].name}" nahráno.`
                : `Nahráno ${uploaded} souborů${errors > 0 ? ` (${errors} selhalo)` : ""}.`;
            setMessage(msg);
        } catch (error) { setMessage(getErrorMessage(error)); }
        finally { setLoading(false); setUploadProgress(""); }
    }

    function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        uploadFiles(Array.from(files));
        e.target.value = ""; // reset input
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        if (screen !== "browser") return;
        const files = Array.from(e.dataTransfer.files).filter(f =>
            f.type.startsWith("image/") || f.type.startsWith("video/")
        );
        if (files.length > 0) uploadFiles(files);
    }

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (screen === "browser") setDragOver(true);
    }

    function handleDragLeave(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
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

    // ── Download ──

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
        } finally { setPreviewLoading(false); }
    }

    function closePreview() {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewFile(null);
        setPreviewUrl("");
    }

    // ── Convert ──

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
        const img = file.mimeType.startsWith("image/");
        setConvertDialog(false);
        setLoading(true); setMessage("");
        try {
            setConvertProgress("Stahuji soubor...");
            const data = await downloadFile(accessToken, file.id);
            setCropFileData(data);
            if (img) {
                const blob = new Blob([data], { type: file.mimeType });
                const url = URL.createObjectURL(blob);
                const image = new Image();
                await new Promise<void>((resolve, reject) => {
                    image.onload = () => resolve();
                    image.onerror = () => reject(new Error("Nelze načíst obrázek."));
                    image.src = url;
                });
                setCropImageUrl(url);
                setCropNatW(image.naturalWidth);
                setCropNatH(image.naturalHeight);
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
        file: DriveFile, ratios: AspectRatio[], data: ArrayBuffer,
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
        } finally { setLoading(false); setCropFileData(null); }
    }

    // ── AI Search ──

    function getGeminiKey(): string {
        return localStorage.getItem("gemini_api_key") ?? "";
    }

    function saveGeminiKey(key: string) {
        localStorage.setItem("gemini_api_key", key);
    }

    async function triggerIndexing(folderFiles: DriveFile[], folderId: string) {
        const apiKey = getGeminiKey();
        if (!apiKey) return;
        try {
            const unindexed = await getUnindexedFiles(db, folderFiles);
            if (unindexed.length === 0) return;

            // Abort previous indexing
            indexAbortRef.current?.abort();
            const controller = new AbortController();
            indexAbortRef.current = controller;

            setIndexingProgress({ done: 0, total: unindexed.length });

            const result = await batchIndexImages(
                db, unindexed, folderId, accessToken, apiKey,
                (done, total) => setIndexingProgress({ done, total }),
                controller.signal
            );

            if (!controller.signal.aborted) {
                setIndexingProgress(null);
                if (result.indexed > 0) {
                    setMessage(`Zaindexováno ${result.indexed} obrázků${result.errors > 0 ? ` (${result.errors} chyb)` : ""}.`);
                }
            }
        } catch {
            setIndexingProgress(null);
        }
    }

    function handleSearchInput(value: string) {
        setSearchQuery(value);
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

        if (!value.trim()) {
            setSearchResults(null);
            return;
        }

        searchTimeoutRef.current = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const results = await searchImages(db, value, searchScope, currentFolderId);
                setSearchResults(results);
            } catch (error) {
                console.warn("Search failed:", error);
                setSearchResults([]);
            } finally {
                setSearchLoading(false);
            }
        }, 400);
    }

    function clearSearch() {
        setSearchQuery("");
        setSearchResults(null);
    }

    function handleSearchResultClick(result: ImageIndexDoc) {
        // Find the file in the current file list or create a minimal DriveFile to preview
        const file = files.find(f => f.id === result.fileId);
        if (file) {
            openPreview(file);
        } else {
            // File is in another folder — create a minimal object for preview
            const minFile: DriveFile = {
                id: result.fileId,
                name: result.fileName,
                mimeType: "image/jpeg", // default, will work for preview
            };
            openPreview(minFile);
        }
    }

    function handleGeminiKeySave() {
        const key = geminiKeyInput.trim();
        if (!key) return;
        saveGeminiKey(key);
        setGeminiKeyDialog(false);
        setGeminiKeyInput("");
        setMessage("Gemini API klíč uložen. Indexace začne automaticky.");
        // Trigger indexing for current folder
        if (screen === "browser") {
            triggerIndexing(files, currentFolderId);
        }
    }

    // ── Effects ──

    useEffect(() => {
        if (screen === "browser" && pendingUploadPicker && fileInputRef.current) {
            fileInputRef.current.click();
            setPendingUploadPicker(false);
        }
    }, [screen, pendingUploadPicker]);

    // Auto-index when folder loads
    useEffect(() => {
        if (screen === "browser" && files.length > 0 && accessToken) {
            triggerIndexing(files, currentFolderId);
        }
        return () => { indexAbortRef.current?.abort(); };
    }, [screen, currentFolderId, files, accessToken]);

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

    const allEmails = accessConfig
        ? [...new Set([...accessConfig.allowedEmails, ...accessConfig.admins])]
        : [];

    // ── Render ──

    return (
        <div
            className="app-shell"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* ── Login ── */}
            {screen === "login" && (
                <div className="login-wrapper">
                    <div className="login-card">
                        <div className="login-logo">CS</div>
                        <h1 className="login-title">Canto Silva</h1>
                        <p className="login-lead">Přihlaste se Google účtem pro přístup ke knihovně.</p>
                        <button className="btn btn-primary btn-lg" onClick={handleLogin} disabled={loading}>
                            {Icons.login} Přihlásit se přes Google
                        </button>
                        {accessDenied && (
                            <div className="login-denied">
                                <p>Účet <strong>{userEmail}</strong> nemá oprávnění.</p>
                                <p>Požádejte administrátora o přidání vašeho emailu.</p>
                            </div>
                        )}
                        {message && !accessDenied && <p className="login-error">{message}</p>}
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
                                <p className="header-email">
                                    {userEmail}
                                    {userIsAdmin && <span className="admin-badge">Admin</span>}
                                </p>
                            </div>
                        </div>
                        <div className="header-actions">
                            {screen === "browser" && (
                                <button className="btn btn-ghost" onClick={() => { setScreen("home"); setSelected(new Set()); }} disabled={loading}>
                                    {Icons.home} Domů
                                </button>
                            )}
                            {userIsAdmin && (
                                <button className="btn btn-ghost" onClick={() => { setAdminPanelOpen(true); refreshAccessConfig(); }} disabled={loading}>
                                    {Icons.settings} Oprávnění
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
                            <button className="home-tile" onClick={() => {
                                if (!getGeminiKey()) { setGeminiKeyDialog(true); return; }
                                setScreen("browser");
                                handleOpenLibrary();
                                setTimeout(() => document.getElementById("search-input")?.focus(), 300);
                            }} disabled={loading}>
                                <div className="tile-icon">{Icons.searchLg}</div>
                                <span className="tile-title">AI Vyhledávání</span>
                                <span className="tile-desc">Hledat obrázky podle obsahu</span>
                            </button>
                            {userIsAdmin && (
                                <button className="home-tile" onClick={() => { setAdminPanelOpen(true); refreshAccessConfig(); }} disabled={loading}>
                                    <div className="tile-icon">{Icons.users}</div>
                                    <span className="tile-title">Oprávnění</span>
                                    <span className="tile-desc">Spravovat přístupy uživatelů</span>
                                </button>
                            )}
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

                            {/* Search bar */}
                            <div className="search-bar-wrap">
                                <div className="search-bar">
                                    <span className="search-bar-icon">{Icons.search}</span>
                                    <input
                                        id="search-input"
                                        className="search-bar-input"
                                        type="text"
                                        placeholder="Hledat obrázky... (např. židle, les, auto)"
                                        value={searchQuery}
                                        onChange={(e) => handleSearchInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Escape") clearSearch(); }}
                                    />
                                    {searchQuery && (
                                        <button className="search-bar-clear" onClick={clearSearch} title="Vymazat">
                                            {Icons.closeSm}
                                        </button>
                                    )}
                                    <div className="search-scope-toggle">
                                        <button
                                            className={`search-scope-btn ${searchScope === "folder" ? "search-scope-active" : ""}`}
                                            onClick={() => { setSearchScope("folder"); if (searchQuery) handleSearchInput(searchQuery); }}
                                            title="Jen tato složka"
                                        >Složka</button>
                                        <button
                                            className={`search-scope-btn ${searchScope === "global" ? "search-scope-active" : ""}`}
                                            onClick={() => { setSearchScope("global"); if (searchQuery) handleSearchInput(searchQuery); }}
                                            title="Všechny složky"
                                        >Vše</button>
                                    </div>
                                    {!getGeminiKey() && (
                                        <button className="btn btn-accent btn-sm" onClick={() => setGeminiKeyDialog(true)} title="Nastavit API klíč">
                                            {Icons.key} API klíč
                                        </button>
                                    )}
                                </div>
                                {indexingProgress && (
                                    <div className="indexing-status">
                                        <span className="spinner" style={{ width: 12, height: 12 }} />
                                        <span>Indexuji obrázky… {indexingProgress.done}/{indexingProgress.total}</span>
                                    </div>
                                )}
                            </div>

                            {/* Search results */}
                            {searchResults !== null && (
                                <div className="search-results">
                                    <div className="search-results-header">
                                        <span className="search-results-count">
                                            {searchLoading ? "Hledám…" :
                                                searchResults.length === 0 ? `Žádné výsledky pro „${searchQuery}"` :
                                                    `${searchResults.length} ${searchResults.length === 1 ? "výsledek" : searchResults.length < 5 ? "výsledky" : "výsledků"}`}
                                        </span>
                                        <button className="btn btn-ghost btn-sm" onClick={clearSearch}>Zavřít hledání</button>
                                    </div>
                                    {searchResults.length > 0 && (
                                        <div className="search-results-grid">
                                            {searchResults.map((result) => (
                                                <button
                                                    key={result.fileId}
                                                    className="search-result-card"
                                                    onClick={() => handleSearchResultClick(result)}
                                                >
                                                    <div className="search-result-icon">{Icons.file}</div>
                                                    <div className="search-result-info">
                                                        <span className="search-result-name">{result.fileName}</span>
                                                        <span className="search-result-desc">
                                                            {result.descriptionCs.slice(0, 100)}
                                                            {result.descriptionCs.length > 100 ? "…" : ""}
                                                        </span>
                                                        <div className="search-result-tags">
                                                            {result.tags.slice(0, 6).map((tag, i) => (
                                                                <span key={i} className="search-tag">{tag}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

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
                                        ref={fileInputRef} type="file" accept="image/*,video/*" multiple
                                        onChange={handleFileInputChange}
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
                                    const isSel = selected.has(file.id);
                                    const canPreview = isMedia(file.mimeType);
                                    const canDownload = !isFld;
                                    const canConvert = isMedia(file.mimeType);

                                    return (
                                        <div className={`file-row ${isFld ? "file-row-folder" : ""} ${isSel ? "file-row-selected" : ""}`} key={file.id}>
                                            <label className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                                                <input type="checkbox" checked={isSel} onChange={() => toggleSelect(file.id)} />
                                            </label>
                                            <div
                                                className="col-name"
                                                onClick={() => { if (isFld) handleFolderClick(file); else if (canPreview) openPreview(file); }}
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
                                                    <button className="btn-icon" title="Náhled" onClick={() => openPreview(file)} disabled={loading}>{Icons.eye}</button>
                                                )}
                                                <button className="btn-icon" title="Přejmenovat" onClick={() => openRenameDialog(file)} disabled={loading}>{Icons.rename}</button>
                                                {canDownload && (
                                                    <button className="btn-icon" title="Stáhnout" onClick={() => handleDownload(file)} disabled={loading}>{Icons.download}</button>
                                                )}
                                                {canConvert && (
                                                    <button className="btn-icon btn-icon-accent" title="Konvertovat" onClick={() => openConvertDialog(file)} disabled={loading}>{Icons.crop}</button>
                                                )}
                                                <button className="btn-icon btn-icon-danger" title="Smazat" onClick={() => handleDeleteSingle(file)} disabled={loading}>{Icons.trash}</button>
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

                    {/* Drag & drop overlay */}
                    {dragOver && screen === "browser" && (
                        <div className="drop-overlay">
                            <div className="drop-overlay-content">
                                {Icons.upload}
                                <span>Přetáhni soubory sem</span>
                            </div>
                        </div>
                    )}

                    {/* Toast */}
                    {(loading || message) && (
                        <div className={`toast ${loading ? "toast-loading" : ""}`}>
                            {loading && <span className="spinner" />}
                            <span>{loading ? (uploadProgress || convertProgress || "Probíhá akce…") : message}</span>
                        </div>
                    )}
                </div>
            )}

            {/* ── New folder dialog ── */}
            {newFolderDialog && (
                <div className="overlay" onClick={() => setNewFolderDialog(false)}>
                    <div className="dialog" onClick={(e) => e.stopPropagation()}>
                        <h2>Nová složka</h2>
                        <input className="dialog-input" type="text" placeholder="Název složky" value={newFolderName}
                            onChange={(e) => setNewFolderName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolderConfirm(); if (e.key === "Escape") setNewFolderDialog(false); }}
                            autoFocus />
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
                        <input className="dialog-input" type="text" placeholder="Nový název" value={renameName}
                            onChange={(e) => setRenameName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm(); if (e.key === "Escape") setRenameDialog(false); }}
                            autoFocus
                            onFocus={(e) => { const d = renameName.lastIndexOf("."); if (d > 0) e.target.setSelectionRange(0, d); else e.target.select(); }} />
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setRenameDialog(false)}>Zrušit</button>
                            <button className="btn btn-primary" onClick={handleRenameConfirm} disabled={!renameName.trim() || renameName.trim() === renameTarget.name}>Přejmenovat</button>
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
                        <p className="dialog-desc"><strong>{convertFile.name}</strong><br />Vyber poměry stran. Výsledky se uloží do stejné složky.</p>
                        <div className="ratio-grid">
                            {ALL_RATIOS.map((r) => (
                                <button key={r} className={`ratio-card ${convertRatios.has(r) ? "ratio-card-active" : ""}`} onClick={() => toggleConvertRatio(r)}>
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
                            <button className="btn btn-primary" onClick={handleConvertNext} disabled={convertRatios.size === 0}>Další {convertRatios.size > 0 ? `(${convertRatios.size})` : ""}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Crop editor ── */}
            {cropEditorOpen && convertFile && (
                <CropEditor imageUrl={cropImageUrl} naturalWidth={cropNatW} naturalHeight={cropNatH}
                    ratios={[...convertRatios]} onConfirm={handleCropConfirm} onCancel={handleCropCancel} />
            )}

            {/* ── Admin panel ── */}
            {adminPanelOpen && accessConfig && (
                <div className="overlay" onClick={() => setAdminPanelOpen(false)}>
                    <div className="dialog dialog-admin" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-icon-accent">{Icons.users}</div>
                        <h2>Správa oprávnění</h2>
                        <p className="dialog-desc">Přidej emaily uživatelů, kteří mají přístup k aplikaci.</p>

                        <div className="admin-add-row">
                            <input
                                className="dialog-input" type="email" placeholder="email@example.com"
                                value={newEmailInput}
                                onChange={(e) => setNewEmailInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleAddEmail(); }}
                            />
                            <button className="btn btn-primary" onClick={handleAddEmail} disabled={!newEmailInput.trim().includes("@") || loading}>
                                {Icons.userPlus} Přidat
                            </button>
                        </div>

                        <div className="admin-email-list">
                            {allEmails.length === 0 && (
                                <p className="admin-empty">Zatím žádní uživatelé.</p>
                            )}
                            {allEmails.sort().map((email) => {
                                const emailIsAdmin = accessConfig.admins.includes(email);
                                const isSelf = email === userEmail;
                                return (
                                    <div key={email} className="admin-email-row">
                                        <div className="admin-email-info">
                                            <span className="admin-email-text">{email}</span>
                                            {emailIsAdmin && <span className="admin-role-badge">Admin</span>}
                                        </div>
                                        <div className="admin-email-actions">
                                            {!isSelf && (
                                                <>
                                                    <button
                                                        className={`btn btn-sm ${emailIsAdmin ? "btn-secondary" : "btn-accent"}`}
                                                        onClick={() => handleToggleAdmin(email, !emailIsAdmin)}
                                                        disabled={loading}
                                                        title={emailIsAdmin ? "Odebrat admin" : "Udělat adminem"}
                                                    >
                                                        {Icons.shield} {emailIsAdmin ? "Odebrat admin" : "Admin"}
                                                    </button>
                                                    <button
                                                        className="btn btn-sm btn-danger"
                                                        onClick={() => handleRemoveEmail(email)}
                                                        disabled={loading}
                                                    >
                                                        {Icons.trash}
                                                    </button>
                                                </>
                                            )}
                                            {isSelf && <span className="admin-self-label">Vy</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="dialog-actions">
                            <button className="btn btn-primary" onClick={() => setAdminPanelOpen(false)}>Zavřít</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Gemini API Key dialog ── */}
            {geminiKeyDialog && (
                <div className="overlay" onClick={() => setGeminiKeyDialog(false)}>
                    <div className="dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-icon-accent"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></div>
                        <h2>Gemini API klíč</h2>
                        <p className="dialog-desc">
                            Pro AI vyhledávání obrázků potřebuješ Gemini API klíč (zdarma).<br />
                            Získej ho na <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>aistudio.google.com/apikey</a>
                        </p>
                        <input
                            className="dialog-input"
                            type="text"
                            placeholder="AIza..."
                            value={geminiKeyInput}
                            onChange={(e) => setGeminiKeyInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleGeminiKeySave(); if (e.key === "Escape") setGeminiKeyDialog(false); }}
                            autoFocus
                        />
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setGeminiKeyDialog(false)}>Zrušit</button>
                            <button className="btn btn-primary" onClick={handleGeminiKeySave} disabled={!geminiKeyInput.trim()}>Uložit</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Preview modal ── */}
            {previewFile && (
                <div className="preview-overlay" onClick={closePreview}>
                    <button className="preview-close" onClick={closePreview} title="Zavřít">{Icons.close}</button>
                    <div className="preview-header">
                        <span className="preview-filename">{previewFile.name}</span>
                        <button className="btn btn-ghost btn-sm preview-download-btn" onClick={(e) => { e.stopPropagation(); handleDownload(previewFile); }}>
                            {Icons.download} Stáhnout
                        </button>
                    </div>
                    <div className="preview-content" onClick={(e) => e.stopPropagation()}>
                        {previewLoading && (
                            <div className="preview-loading"><span className="spinner spinner-lg" /><span>Načítám náhled…</span></div>
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
