import type { DriveFile } from "../types";

async function googleFetch(
    url: string,
    accessToken: string,
    init?: RequestInit
): Promise<Response> {
    const response = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            ...(init?.headers ?? {})
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Google API chyba ${response.status}: ${text}`);
    }

    return response;
}

function sortFiles(files: DriveFile[]) {
    return [...files].sort((a, b) => {
        const aFolder = a.mimeType === "application/vnd.google-apps.folder";
        const bFolder = b.mimeType === "application/vnd.google-apps.folder";

        if (aFolder && !bFolder) return -1;
        if (!aFolder && bFolder) return 1;

        return a.name.localeCompare(b.name, "cs", { sensitivity: "base" });
    });
}

export async function listFolder(
    accessToken: string,
    parentFolderId: string
): Promise<DriveFile[]> {
    const params = new URLSearchParams({
        q: `'${parentFolderId}' in parents and trashed = false`,
        fields:
            "files(id,name,mimeType,size,modifiedTime,thumbnailLink,iconLink,webViewLink)",
        pageSize: "1000"
    });

    const response = await googleFetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
        accessToken,
        { method: "GET" }
    );

    const json = (await response.json()) as { files?: DriveFile[] };
    return sortFiles(json.files ?? []);
}

export async function createFolder(
    accessToken: string,
    parentFolderId: string,
    folderName: string
): Promise<void> {
    await googleFetch("https://www.googleapis.com/drive/v3/files", accessToken, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify({
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentFolderId]
        })
    });
}

export async function uploadToDrive(
    accessToken: string,
    file: File,
    parentFolderId: string
): Promise<void> {
    const metadata = {
        name: file.name,
        parents: [parentFolderId]
    };

    const startResponse = await googleFetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
        accessToken,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": file.type || "application/octet-stream",
                "X-Upload-Content-Length": String(file.size)
            },
            body: JSON.stringify(metadata)
        }
    );

    const sessionUrl = startResponse.headers.get("location");
    if (!sessionUrl) {
        throw new Error("Google nevrátil resumable upload URL.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    const uploadResponse = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
            "Content-Type": file.type || "application/octet-stream"
        },
        body: bytes
    });

    if (!uploadResponse.ok) {
        const text = await uploadResponse.text();
        throw new Error(`Upload selhal ${uploadResponse.status}: ${text}`);
    }
}

export async function downloadFile(
    accessToken: string,
    fileId: string
): Promise<ArrayBuffer> {
    const response = await googleFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
        accessToken,
        { method: "GET" }
    );
    return await response.arrayBuffer();
}

export async function renameFile(
    accessToken: string,
    fileId: string,
    newName: string
): Promise<void> {
    await googleFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        accessToken,
        {
            method: "PATCH",
            headers: { "Content-Type": "application/json; charset=UTF-8" },
            body: JSON.stringify({ name: newName })
        }
    );
}

export async function deleteFile(
    accessToken: string,
    fileId: string
): Promise<void> {
    await googleFetch(
        `https://www.googleapis.com/drive/v3/files/${fileId}`,
        accessToken,
        { method: "DELETE" }
    );
}
