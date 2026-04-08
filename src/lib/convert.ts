export type AspectRatio = "1:1" | "4:5" | "16:9";

export const ALL_RATIOS: AspectRatio[] = ["1:1", "4:5", "16:9"];

const RATIO_VALUES: Record<AspectRatio, number> = {
    "1:1": 1,
    "4:5": 4 / 5,
    "16:9": 16 / 9,
};

export const RATIO_SUFFIXES: Record<AspectRatio, string> = {
    "1:1": "1x1",
    "4:5": "4x5",
    "16:9": "16x9",
};

/**
 * Compute crop rect for a given aspect ratio.
 * `panX` and `panY` are in range [0, 1] where 0.5 = centered.
 */
export function computeCrop(
    srcW: number,
    srcH: number,
    ratio: AspectRatio,
    panX = 0.5,
    panY = 0.5
) {
    const targetRatio = RATIO_VALUES[ratio];
    const srcRatio = srcW / srcH;
    let w: number, h: number;

    if (srcRatio > targetRatio) {
        h = srcH;
        w = Math.round(srcH * targetRatio);
    } else {
        w = srcW;
        h = Math.round(srcW / targetRatio);
    }

    w = w % 2 === 0 ? w : w - 1;
    h = h % 2 === 0 ? h : h - 1;

    const maxX = srcW - w;
    const maxY = srcH - h;
    const x = Math.round(maxX * Math.max(0, Math.min(1, panX)));
    const y = Math.round(maxY * Math.max(0, Math.min(1, panY)));

    return { w, h, x, y };
}

export function makeConvertedName(
    originalName: string,
    ratio: AspectRatio,
    isVideo: boolean
): string {
    const suffix = RATIO_SUFFIXES[ratio];
    const dotIdx = originalName.lastIndexOf(".");
    const base = dotIdx > 0 ? originalName.substring(0, dotIdx) : originalName;
    const origExt = dotIdx > 0 ? originalName.substring(dotIdx + 1) : "";
    const ext = isVideo ? "webm" : (origExt || "jpg");
    return `${base}_${suffix}.${ext}`;
}

// ── Image crop ──

export async function cropImage(
    data: ArrayBuffer,
    mimeType: string,
    ratio: AspectRatio,
    panX = 0.5,
    panY = 0.5
): Promise<Blob> {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    try {
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Nepodařilo se načíst obrázek."));
            img.src = url;
        });
        const { w, h, x, y } = computeCrop(img.naturalWidth, img.naturalHeight, ratio, panX, panY);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        const outType = mimeType === "image/png" ? "image/png" : "image/jpeg";
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (b) => (b ? resolve(b) : reject(new Error("Export obrázku selhal."))),
                outType,
                0.92
            );
        });
    } finally {
        URL.revokeObjectURL(url);
    }
}

// ── Video crop ──

export async function cropVideo(
    data: ArrayBuffer,
    mimeType: string,
    ratio: AspectRatio,
    panX = 0.5,
    panY = 0.5
): Promise<Blob> {
    if (typeof MediaRecorder === "undefined") {
        throw new Error("Video konverze není v tomto prostředí podporována.");
    }
    const srcBlob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(srcBlob);
    try {
        const video = document.createElement("video");
        video.playsInline = true;
        video.preload = "auto";
        video.src = url;
        await new Promise<void>((resolve, reject) => {
            video.onloadedmetadata = () => resolve();
            video.onerror = () => reject(new Error("Nepodařilo se načíst video."));
        });
        await new Promise<void>((resolve) => {
            if (video.readyState >= 2) { resolve(); return; }
            video.oncanplay = () => resolve();
        });
        const { w, h, x, y } = computeCrop(video.videoWidth, video.videoHeight, ratio, panX, panY);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        const canvasStream = canvas.captureStream(30);
        const combinedStream = new MediaStream(canvasStream.getVideoTracks());
        let audioCtx: AudioContext | null = null;
        try {
            audioCtx = new AudioContext();
            const source = audioCtx.createMediaElementSource(video);
            const dest = audioCtx.createMediaStreamDestination();
            source.connect(dest);
            for (const track of dest.stream.getAudioTracks()) combinedStream.addTrack(track);
        } catch { /* no audio */ }
        const outMime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
            ? "video/webm;codecs=vp9"
            : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4";
        const recorder = new MediaRecorder(combinedStream, { mimeType: outMime, videoBitsPerSecond: 5_000_000 });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        const done = new Promise<Blob>((resolve) => {
            recorder.onstop = () => {
                if (audioCtx) audioCtx.close();
                resolve(new Blob(chunks, { type: outMime.startsWith("video/mp4") ? "video/mp4" : "video/webm" }));
            };
        });
        recorder.start();
        video.muted = false;
        await video.play();
        function drawFrame() {
            if (video.ended || video.paused) { if (recorder.state === "recording") recorder.stop(); return; }
            ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
            requestAnimationFrame(drawFrame);
        }
        drawFrame();
        video.onended = () => { if (recorder.state === "recording") recorder.stop(); };
        return await done;
    } finally {
        URL.revokeObjectURL(url);
    }
}
