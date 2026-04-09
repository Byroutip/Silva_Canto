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
import {
    refreshAllUpdates,
    getStoredUpdates,
    askMarketingQuestion,
    fetchBaseline,
    hasBaseline,
    type AlgorithmUpdate,
    type MarketingQuery,
} from "./lib/marketing";
import {
    getCanvaTokens,
    startCanvaAuth,
    handleCanvaCallback,
    createCanvaDesign,
    getPendingAction,
    savePendingAction,
} from "./lib/canva";

type Screen = "login" | "home" | "browser" | "marketing";

const ROOT_FOLDER_ID = import.meta.env.VITE_ROOT_FOLDER_ID;
const ROOT_FOLDER_NAME = import.meta.env.VITE_ROOT_FOLDER_NAME || "Kořen";
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

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
    trendUp: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    trendUpSm: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
    send: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
    chevDown: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>,
    chevUp: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>,
    externalLink: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>,
    canva: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h18"/></svg>,
    canvaLg: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h18"/></svg>,
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
    // Canva dialog
    const [canvaDialog, setCanvaDialog] = useState(false);
    const [canvaFile, setCanvaFile] = useState<DriveFile | null>(null);

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
    const [totalIndexed, setTotalIndexed] = useState(0);

    // Marketing
    const [mktUpdates, setMktUpdates] = useState<AlgorithmUpdate[]>([]);
    const [mktLoading, setMktLoading] = useState(false);
    const [mktProgress, setMktProgress] = useState("");
    const [mktQuestion, setMktQuestion] = useState("");
    const [mktAnswer, setMktAnswer] = useState<MarketingQuery | null>(null);
    const [mktAskLoading, setMktAskLoading] = useState(false);
    const [mktExpandedId, setMktExpandedId] = useState<string | null>(null);
    const [mktFilter, setMktFilter] = useState<"all" | "facebook" | "instagram" | "baseline">("all");

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

    // ── Canva ──

    type CanvaFormat = "1:1" | "4:5" | "16:9" | "9:16" | "original";

    const CANVA_FORMAT_INFO: Record<CanvaFormat, { label: string; w: number; h: number }> = {
        "1:1": { label: "1:1 (Instagram post)", w: 1080, h: 1080 },
        "4:5": { label: "4:5 (Instagram portrét)", w: 1080, h: 1350 },
        "16:9": { label: "16:9 (Prezentace)", w: 1920, h: 1080 },
        "9:16": { label: "9:16 (Instagram story)", w: 1080, h: 1920 },
        "original": { label: "Originál", w: 0, h: 0 },
    };

    const CANVA_REDIRECT_URI = window.location.origin + "/";

    function openCanvaDialog(file: DriveFile) {
        setCanvaFile(file);
        setCanvaDialog(true);
    }

    async function openInCanva(format: CanvaFormat) {
        if (!canvaFile) return;
        const file = canvaFile;
        setCanvaDialog(false);

        const tokens = getCanvaTokens();
        if (!tokens) {
            // Save pending action and start OAuth
            const info = CANVA_FORMAT_INFO[format];
            savePendingAction({
                fileId: file.id,
                fileName: file.name,
                mimeType: file.mimeType,
                format,
                width: info.w,
                height: info.h,
            });
            await startCanvaAuth(CANVA_REDIRECT_URI);
            return;
        }

        await executeCanvaDesign(file, format);
    }

    async function executeCanvaDesign(file: DriveFile, format: CanvaFormat) {
        setLoading(true);
        setMessage("");
        try {
            setConvertProgress("Stahuji obrázek…");
            const data = await downloadFile(accessToken, file.id);

            let imageData: ArrayBuffer;
            let mimeType = file.mimeType;

            if (format !== "original") {
                setConvertProgress(`Ořezávám na ${format}…`);
                const cropped = await cropImage(data, file.mimeType, format as AspectRatio);
                imageData = await cropped.arrayBuffer();
                mimeType = cropped.type;
            } else {
                imageData = data;
            }

            const info = CANVA_FORMAT_INFO[format];
            let w = info.w;
            let h = info.h;

            // For original, detect dimensions from the image
            if (format === "original") {
                const blob = new Blob([data], { type: file.mimeType });
                const url = URL.createObjectURL(blob);
                const img = new Image();
                await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(); img.src = url; });
                w = img.naturalWidth;
                h = img.naturalHeight;
                URL.revokeObjectURL(url);
                // Clamp to Canva limits (40-8000)
                w = Math.max(40, Math.min(8000, w));
                h = Math.max(40, Math.min(8000, h));
            }

            const editUrl = await createCanvaDesign(
                imageData,
                file.name,
                mimeType,
                w, h,
                file.name.replace(/\.[^.]+$/, ""),
                (msg) => setConvertProgress(msg)
            );

            setConvertProgress("");
            window.open(editUrl, "_blank");
            setMessage("Návrh vytvořen v Canvě — otevírám editor.");
        } catch (error) {
            setConvertProgress("");
            setMessage(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }

    // Detect Canva OAuth callback on initial load (before Google login)
    const [canvaCallbackPending, setCanvaCallbackPending] = useState<{ code: string; state: string } | null>(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");
        if (code && state) {
            window.history.replaceState({}, "", window.location.pathname);
            return { code, state };
        }
        return null;
    });

    // Execute Canva callback once Google accessToken is available
    useEffect(() => {
        if (!canvaCallbackPending || !accessToken) return;
        const { code, state } = canvaCallbackPending;
        setCanvaCallbackPending(null);

        handleCanvaCallback(code, state, CANVA_REDIRECT_URI)
            .then(() => {
                const pending = getPendingAction();
                if (pending) {
                    const file: DriveFile = {
                        id: pending.fileId,
                        name: pending.fileName,
                        mimeType: pending.mimeType,
                    };
                    executeCanvaDesign(file, pending.format as CanvaFormat);
                } else {
                    setMessage("Canva propojeno — zkus to znovu.");
                }
            })
            .catch((err) => {
                setMessage(`Canva autorizace selhala: ${getErrorMessage(err)}`);
            });
    }, [canvaCallbackPending, accessToken]);

    // ── AI Search ──

    function geminiKey(): string {
        return GEMINI_API_KEY || localStorage.getItem("gemini_api_key") || "";
    }

    async function triggerIndexing(folderFiles: DriveFile[], folderId: string) {
        const apiKey = geminiKey();
        if (!apiKey) {
            console.warn("No Gemini API key configured");
            return;
        }

        const imageFiles = folderFiles.filter(f => f.mimeType.startsWith("image/"));
        if (imageFiles.length === 0) return;

        try {
            const unindexed = await getUnindexedFiles(db, imageFiles);
            const alreadyIndexed = imageFiles.length - unindexed.length;
            setTotalIndexed(alreadyIndexed);

            if (unindexed.length === 0) return;

            // Abort previous indexing
            indexAbortRef.current?.abort();
            const controller = new AbortController();
            indexAbortRef.current = controller;

            setIndexingProgress({ done: 0, total: unindexed.length });

            const result = await batchIndexImages(
                db, unindexed, folderId, accessToken, apiKey,
                (done, total) => {
                    setIndexingProgress({ done, total });
                    setTotalIndexed(alreadyIndexed + done);
                },
                controller.signal
            );

            if (!controller.signal.aborted) {
                setIndexingProgress(null);
                setTotalIndexed(alreadyIndexed + result.indexed);
                if (result.errors > 0) {
                    setMessage(`Indexace: ${result.indexed} OK, ${result.errors} chyb.`);
                }
            }
        } catch (error) {
            console.error("Indexing error:", error);
            setIndexingProgress(null);
            setMessage(`Chyba indexace: ${getErrorMessage(error)}`);
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
        const file = files.find(f => f.id === result.fileId);
        if (file) {
            openPreview(file);
        } else {
            openPreview({
                id: result.fileId,
                name: result.fileName,
                mimeType: "image/jpeg",
            });
        }
    }

    // ── Marketing ──

    async function openMarketing() {
        setScreen("marketing");
        setMktLoading(true);
        try {
            const stored = await getStoredUpdates(db);
            setMktUpdates(stored);

            // Auto-fetch baseline if first time (no data yet)
            const apiKey = geminiKey();
            if (!hasBaseline(stored) && apiKey) {
                setMktProgress("Stahuji aktuální stav algoritmů…");
                await fetchBaseline(db, apiKey, (msg) => setMktProgress(msg));
                const updated = await getStoredUpdates(db);
                setMktUpdates(updated);
                setMktProgress("");
                setMessage("Stažen kompletní přehled aktuálních algoritmů.");
            }
        } catch (error) {
            console.error("Failed to load marketing updates:", error);
            setMktProgress("");
            setMessage(getErrorMessage(error));
        } finally {
            setMktLoading(false);
        }
    }

    async function handleMktRefresh() {
        const apiKey = geminiKey();
        if (!apiKey) { setMessage("Chybí Gemini API klíč."); return; }
        setMktLoading(true); setMktProgress("");
        try {
            const allUpdates = await refreshAllUpdates(db, apiKey, (msg) => setMktProgress(msg));
            setMktUpdates(allUpdates);
            setMktProgress("");
            const newCount = allUpdates.filter(u => !u.id.startsWith("baseline-")).length;
            setMessage(`Celkem ${newCount} novinek v historii.`);
        } catch (error) {
            setMktProgress("");
            setMessage(getErrorMessage(error));
        } finally {
            setMktLoading(false);
        }
    }

    async function handleMktAsk() {
        const q = mktQuestion.trim();
        if (!q) return;
        const apiKey = geminiKey();
        if (!apiKey) { setMessage("Chybí Gemini API klíč."); return; }
        setMktAskLoading(true); setMktAnswer(null);
        try {
            const result = await askMarketingQuestion(q, apiKey);
            setMktAnswer(result);
        } catch (error) {
            setMessage(getErrorMessage(error));
        } finally {
            setMktAskLoading(false);
        }
    }

    const filteredMktUpdates = mktFilter === "all"
        ? mktUpdates
        : mktFilter === "baseline"
            ? mktUpdates.filter(u => u.id.startsWith("baseline-"))
            : mktUpdates.filter(u => u.platform === mktFilter);

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
                            {(screen === "browser" || screen === "marketing") && (
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
                            <button className="home-tile" onClick={openMarketing} disabled={loading}>
                                <div className="tile-icon tile-icon-marketing">{Icons.trendUp}</div>
                                <span className="tile-title">Marketingové algoritmy</span>
                                <span className="tile-desc">Novinky a změny algoritmů FB & IG</span>
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
                            {geminiKey() && (
                                <div className="search-bar-wrap">
                                    <div className="search-bar">
                                        <span className="search-bar-icon">{Icons.search}</span>
                                        <input
                                            id="search-input"
                                            className="search-bar-input"
                                            type="text"
                                            placeholder="Hledat obrázky… např. židle, les, auto, modrá obloha"
                                            value={searchQuery}
                                            onChange={(e) => handleSearchInput(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Escape") clearSearch(); }}
                                        />
                                        {searchQuery && (
                                            <button className="search-bar-clear" onClick={clearSearch} title="Vymazat">
                                                {Icons.closeSm}
                                            </button>
                                        )}
                                        {searchLoading && <span className="spinner" style={{ width: 14, height: 14 }} />}
                                        <div className="search-scope-toggle">
                                            <button
                                                className={`search-scope-btn ${searchScope === "folder" ? "search-scope-active" : ""}`}
                                                onClick={() => { setSearchScope("folder"); if (searchQuery) handleSearchInput(searchQuery); }}
                                            >Složka</button>
                                            <button
                                                className={`search-scope-btn ${searchScope === "global" ? "search-scope-active" : ""}`}
                                                onClick={() => { setSearchScope("global"); if (searchQuery) handleSearchInput(searchQuery); }}
                                            >Vše</button>
                                        </div>
                                    </div>
                                    {indexingProgress && (
                                        <div className="indexing-status">
                                            <div className="indexing-bar">
                                                <div className="indexing-bar-fill" style={{ width: `${(indexingProgress.done / indexingProgress.total) * 100}%` }} />
                                            </div>
                                            <span>Indexuji {indexingProgress.done}/{indexingProgress.total} obrázků…</span>
                                        </div>
                                    )}
                                    {!indexingProgress && totalIndexed > 0 && !searchQuery && (
                                        <div className="indexing-status">
                                            <span className="index-ready-dot" />
                                            <span>{totalIndexed} obrázků zaindexováno — vyhledávání připraveno</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Search results — image grid */}
                            {searchResults !== null && (
                                <div className="search-results-panel">
                                    <div className="search-results-header">
                                        <span className="search-results-count">
                                            {searchResults.length === 0
                                                ? `Nic nenalezeno pro „${searchQuery}"`
                                                : `${searchResults.length} ${searchResults.length === 1 ? "nalezen" : "nalezeno"}`}
                                        </span>
                                        <button className="btn btn-ghost btn-sm" onClick={clearSearch}>{Icons.closeSm} Zavřít</button>
                                    </div>
                                    {searchResults.length > 0 && (
                                        <div className="search-grid">
                                            {searchResults.map((result) => {
                                                // Find corresponding DriveFile for thumbnail
                                                const driveFile = files.find(f => f.id === result.fileId);
                                                const thumbUrl = driveFile?.thumbnailLink?.replace(/=s\d+/, "=s300");
                                                return (
                                                    <button
                                                        key={result.fileId}
                                                        className="search-grid-item"
                                                        onClick={() => handleSearchResultClick(result)}
                                                        title={result.descriptionCs}
                                                    >
                                                        <div className="search-grid-thumb">
                                                            {thumbUrl ? (
                                                                <img
                                                                    src={thumbUrl}
                                                                    alt={result.fileName}
                                                                    crossOrigin="anonymous"
                                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                                                />
                                                            ) : (
                                                                <div className="search-grid-thumb-placeholder">{Icons.file}</div>
                                                            )}
                                                        </div>
                                                        <span className="search-grid-name">{result.fileName}</span>
                                                        <div className="search-grid-tags">
                                                            {result.tags.slice(0, 3).map((tag, i) => (
                                                                <span key={i} className="search-tag">{tag}</span>
                                                            ))}
                                                        </div>
                                                    </button>
                                                );
                                            })}
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
                                                {file.mimeType.startsWith("image/") && (
                                                    <button className="btn-icon btn-icon-accent" title="Otevřít v Canvě" onClick={() => openCanvaDialog(file)} disabled={loading}>{Icons.canva}</button>
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

                    {/* ── Marketing dashboard ── */}
                    {screen === "marketing" && (
                        <div className="mkt-dashboard">
                            <div className="mkt-header">
                                <div>
                                    <h2 className="mkt-title">{Icons.trendUpSm} Marketingové algoritmy</h2>
                                    <p className="mkt-subtitle">Aktuální změny algoritmů Facebooku a Instagramu, vysvětlené jednoduše</p>
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleMktRefresh}
                                    disabled={mktLoading}
                                >
                                    {Icons.refresh} Aktualizovat novinky
                                </button>
                            </div>

                            {/* AI Question */}
                            <div className="mkt-ask-wrap">
                                <div className="mkt-ask-bar">
                                    <span className="search-bar-icon">{Icons.search}</span>
                                    <input
                                        className="search-bar-input"
                                        type="text"
                                        placeholder="Zeptej se na cokoliv o algoritmech… např. &quot;Jak zvýšit dosah na Instagramu?&quot;"
                                        value={mktQuestion}
                                        onChange={(e) => setMktQuestion(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleMktAsk(); }}
                                    />
                                    <button
                                        className="btn btn-primary btn-sm"
                                        onClick={handleMktAsk}
                                        disabled={mktAskLoading || !mktQuestion.trim()}
                                    >
                                        {mktAskLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : Icons.send}
                                        Zeptat se
                                    </button>
                                </div>
                                {mktAnswer && (
                                    <div className="mkt-answer">
                                        <div className="mkt-answer-q">
                                            <strong>Otázka:</strong> {mktAnswer.question}
                                        </div>
                                        <div className="mkt-answer-text">{mktAnswer.answer}</div>
                                        {mktAnswer.sources.length > 0 && (
                                            <div className="mkt-answer-sources">
                                                {mktAnswer.sources.slice(0, 3).map((src, i) => (
                                                    <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="mkt-source-link">
                                                        {Icons.externalLink} Zdroj {i + 1}
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                        <button className="btn btn-ghost btn-sm" onClick={() => setMktAnswer(null)}>Zavřít</button>
                                    </div>
                                )}
                            </div>

                            {/* Filter tabs */}
                            <div className="mkt-filter-row">
                                <div className="mkt-filter-tabs">
                                    <button
                                        className={`mkt-filter-tab ${mktFilter === "all" ? "mkt-filter-active" : ""}`}
                                        onClick={() => setMktFilter("all")}
                                    >Vše</button>
                                    <button
                                        className={`mkt-filter-tab ${mktFilter === "facebook" ? "mkt-filter-active" : ""}`}
                                        onClick={() => setMktFilter("facebook")}
                                    >Facebook</button>
                                    <button
                                        className={`mkt-filter-tab ${mktFilter === "instagram" ? "mkt-filter-active" : ""}`}
                                        onClick={() => setMktFilter("instagram")}
                                    >Instagram</button>
                                    {mktUpdates.some(u => u.id.startsWith("baseline-")) && (
                                        <button
                                            className={`mkt-filter-tab ${mktFilter === "baseline" ? "mkt-filter-active" : ""}`}
                                            onClick={() => setMktFilter("baseline")}
                                        >Jak fungují algoritmy</button>
                                    )}
                                </div>
                                {mktUpdates.length > 0 && (
                                    <span className="mkt-update-count">{filteredMktUpdates.length} novinek</span>
                                )}
                            </div>

                            {/* Loading */}
                            {mktLoading && (
                                <div className="mkt-loading">
                                    <span className="spinner" />
                                    <span>{mktProgress || "Načítám…"}</span>
                                </div>
                            )}

                            {/* Empty state */}
                            {!mktLoading && mktUpdates.length === 0 && (
                                <div className="mkt-empty">
                                    <div style={{ opacity: 0.3 }}>{Icons.trendUp}</div>
                                    <p>Zatím žádné novinky</p>
                                    <p>Klikni na <strong>Aktualizovat novinky</strong> pro stažení aktuálních změn algoritmů.</p>
                                </div>
                            )}

                            {/* Updates list */}
                            {!mktLoading && filteredMktUpdates.length > 0 && (
                                <div className="mkt-updates">
                                    {filteredMktUpdates.map((update) => {
                                        const isExpanded = mktExpandedId === update.id;
                                        return (
                                            <div key={update.id} className={`mkt-card ${isExpanded ? "mkt-card-expanded" : ""}`}>
                                                <button
                                                    className="mkt-card-header"
                                                    onClick={() => setMktExpandedId(isExpanded ? null : update.id)}
                                                >
                                                    <div className="mkt-card-left">
                                                        <span className={`mkt-platform-badge mkt-platform-${update.platform}`}>
                                                            {update.platform === "facebook" ? "FB" : "IG"}
                                                        </span>
                                                        <div className="mkt-card-title-wrap">
                                                            <span className="mkt-card-title">{update.title}</span>
                                                            <span className="mkt-card-date">{update.date}</span>
                                                        </div>
                                                    </div>
                                                    <span className="mkt-card-chevron">
                                                        {isExpanded ? Icons.chevUp : Icons.chevDown}
                                                    </span>
                                                </button>
                                                <div className="mkt-card-summary">{update.summary}</div>
                                                {isExpanded && (
                                                    <div className="mkt-card-details">
                                                        <div className="mkt-card-details-text">{update.details}</div>
                                                        {update.tags.length > 0 && (
                                                            <div className="mkt-card-tags">
                                                                {update.tags.map((tag, i) => (
                                                                    <span key={i} className="search-tag">{tag}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        {update.sources.length > 0 && (
                                                            <div className="mkt-card-sources">
                                                                {update.sources.slice(0, 3).map((src, i) => (
                                                                    <a key={i} href={src} target="_blank" rel="noopener noreferrer" className="mkt-source-link">
                                                                        {Icons.externalLink} Zdroj
                                                                    </a>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
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

            {/* ── Canva dialog ── */}
            {canvaDialog && canvaFile && (
                <div className="overlay" onClick={() => setCanvaDialog(false)}>
                    <div className="dialog dialog-convert" onClick={(e) => e.stopPropagation()}>
                        <div className="dialog-icon-accent">{Icons.canvaLg}</div>
                        <h2>Otevřít v Canvě</h2>
                        <p className="dialog-desc"><strong>{canvaFile.name}</strong><br />Obrázek se ořízne do vybraného formátu, stáhne se a otevře se Canva s novým návrhem.</p>
                        <div className="ratio-grid">
                            {(["1:1", "4:5", "16:9", "9:16", "original"] as const).map((r) => (
                                <button key={r} className="ratio-card" onClick={() => openInCanva(r)} disabled={loading}>
                                    {r !== "original" ? (
                                        <div className={`ratio-preview ratio-preview-${r.replace(":", "x")}`} />
                                    ) : (
                                        <div className="ratio-preview" style={{ width: 40, height: 30, borderRadius: 4 }} />
                                    )}
                                    <span className="ratio-label">{CANVA_FORMAT_INFO[r].label}</span>
                                </button>
                            ))}
                        </div>
                        <div className="dialog-actions">
                            <button className="btn btn-ghost" onClick={() => setCanvaDialog(false)}>Zrušit</button>
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

            {/* ── Preview modal ── */}
            {previewFile && (
                <div className="preview-overlay" onClick={closePreview}>
                    <button className="preview-close" onClick={closePreview} title="Zavřít">{Icons.close}</button>
                    <div className="preview-header">
                        <span className="preview-filename">{previewFile.name}</span>
                        <button className="btn btn-ghost btn-sm preview-download-btn" onClick={(e) => { e.stopPropagation(); handleDownload(previewFile); }}>
                            {Icons.download} Stáhnout
                        </button>
                        {previewFile.mimeType.startsWith("image/") && (
                            <button className="btn btn-accent btn-sm preview-download-btn" onClick={(e) => { e.stopPropagation(); openCanvaDialog(previewFile); }}>
                                {Icons.canva} Canva
                            </button>
                        )}
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
