/**
 * Image indexing & search engine.
 * Uses Gemini for image descriptions, Firestore for persistence.
 */

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    where,
    type Firestore,
} from "firebase/firestore";
import type { DriveFile } from "../types";
import { describeImage, type ImageDescription } from "./gemini";

export type ImageIndexDoc = {
    fileId: string;
    fileName: string;
    folderId: string;
    descriptionCs: string;
    descriptionEn: string;
    tags: string[];
    indexedAt: number; // Date.now()
    modelVersion: string;
};

export type SearchResult = DriveFile & {
    score: number;
    snippet: string;
};

const COLLECTION = "imageIndex";
const MODEL_VERSION = "gemini-2.0-flash-v1";

// ── Normalize text (strip diacritics, lowercase) ──

function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

// ── Fetch thumbnail as base64 ──

async function fetchThumbnailBase64(
    file: DriveFile,
    accessToken: string
): Promise<{ base64: string; mimeType: string }> {
    // Prefer thumbnailLink, fallback to downloading the file
    let url: string;
    if (file.thumbnailLink) {
        // Drive thumbnail links need auth and we want a bigger size
        url = file.thumbnailLink.replace(/=s\d+/, "=s400");
    } else {
        // Download the full file as fallback (for small images)
        url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    }

    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
        throw new Error(`Thumbnail fetch failed: ${response.status}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    return {
        base64,
        mimeType: blob.type || file.mimeType,
    };
}

// ── Check which files need indexing ──

export async function getUnindexedFiles(
    db: Firestore,
    files: DriveFile[]
): Promise<DriveFile[]> {
    const imageFiles = files.filter((f) => f.mimeType.startsWith("image/"));
    if (imageFiles.length === 0) return [];

    const unindexed: DriveFile[] = [];

    // Check in batches of 10 (Firestore 'in' query limit)
    for (let i = 0; i < imageFiles.length; i += 10) {
        const batch = imageFiles.slice(i, i + 10);
        const ids = batch.map((f) => f.id);

        const q = query(
            collection(db, COLLECTION),
            where("fileId", "in", ids)
        );
        const snap = await getDocs(q);
        const indexedIds = new Set(snap.docs.map((d) => d.data().fileId));

        for (const file of batch) {
            if (!indexedIds.has(file.id)) {
                unindexed.push(file);
            }
        }
    }

    return unindexed;
}

// ── Index a single image ──

export async function indexSingleImage(
    db: Firestore,
    file: DriveFile,
    folderId: string,
    accessToken: string,
    geminiApiKey: string
): Promise<void> {
    const { base64, mimeType } = await fetchThumbnailBase64(file, accessToken);
    const desc: ImageDescription = await describeImage(
        base64,
        mimeType,
        geminiApiKey
    );

    const indexDoc: ImageIndexDoc = {
        fileId: file.id,
        fileName: file.name,
        folderId,
        descriptionCs: desc.descriptionCs,
        descriptionEn: desc.descriptionEn,
        tags: desc.tags,
        indexedAt: Date.now(),
        modelVersion: MODEL_VERSION,
    };

    await setDoc(doc(db, COLLECTION, file.id), indexDoc);
}

// ── Batch index with progress callback ──

export async function batchIndexImages(
    db: Firestore,
    files: DriveFile[],
    folderId: string,
    accessToken: string,
    geminiApiKey: string,
    onProgress: (done: number, total: number) => void,
    signal?: AbortSignal
): Promise<{ indexed: number; errors: number }> {
    let indexed = 0;
    let errors = 0;
    const total = files.length;
    let retryDelay = 500;

    for (let i = 0; i < files.length; i++) {
        if (signal?.aborted) break;

        try {
            await indexSingleImage(
                db,
                files[i],
                folderId,
                accessToken,
                geminiApiKey
            );
            indexed++;
            retryDelay = 500; // reset on success
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === "RATE_LIMIT"
            ) {
                // Exponential backoff
                await new Promise((r) => setTimeout(r, retryDelay));
                retryDelay = Math.min(retryDelay * 2, 8000);
                i--; // retry this file
                continue;
            }
            console.warn(`Index failed for ${files[i].name}:`, error);
            errors++;
        }

        onProgress(indexed + errors, total);

        // Small delay between requests to be gentle on rate limits
        if (i < files.length - 1) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }

    return { indexed, errors };
}

// ── Search ──

export async function searchImages(
    db: Firestore,
    queryText: string,
    scope: "folder" | "global",
    folderId?: string
): Promise<ImageIndexDoc[]> {
    const normalizedQuery = normalize(queryText);
    const queryTerms = normalizedQuery
        .split(/\s+/)
        .filter((t) => t.length > 1);
    if (queryTerms.length === 0) return [];

    // Load all index docs for the scope
    let q;
    if (scope === "folder" && folderId) {
        q = query(
            collection(db, COLLECTION),
            where("folderId", "==", folderId)
        );
    } else {
        q = query(collection(db, COLLECTION));
    }

    const snap = await getDocs(q);
    const results: (ImageIndexDoc & { _score: number })[] = [];

    for (const docSnap of snap.docs) {
        const data = docSnap.data() as ImageIndexDoc;

        // Build searchable text
        const searchText = normalize(
            [
                data.descriptionCs,
                data.descriptionEn,
                data.tags.join(" "),
                data.fileName,
            ].join(" ")
        );

        // Score by counting term matches
        let score = 0;
        for (const term of queryTerms) {
            const idx = searchText.indexOf(term);
            if (idx !== -1) {
                score += 1;
                // Bonus for tag exact match
                if (
                    data.tags.some(
                        (t) => normalize(t) === term
                    )
                ) {
                    score += 2;
                }
            }
        }

        if (score > 0) {
            results.push({ ...data, _score: score });
        }
    }

    // Sort by score descending
    results.sort((a, b) => b._score - a._score);

    return results;
}

// ── Get index for a single file ──

export async function getImageIndex(
    db: Firestore,
    fileId: string
): Promise<ImageIndexDoc | null> {
    const snap = await getDoc(doc(db, COLLECTION, fileId));
    if (!snap.exists()) return null;
    return snap.data() as ImageIndexDoc;
}
