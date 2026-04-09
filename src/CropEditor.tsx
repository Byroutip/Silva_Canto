import { useCallback, useEffect, useRef, useState } from "react";
import { computeCrop, type AspectRatio } from "./lib/convert";

type Props = {
    imageUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    ratios: AspectRatio[];
    onConfirm: (positions: Record<AspectRatio, { panX: number; panY: number }>) => void;
    onCancel: () => void;
};

const RATIO_LABELS: Record<AspectRatio, string> = {
    "1:1": "1 : 1",
    "4:5": "4 : 5",
    "16:9": "16 : 9",
    "9:16": "9 : 16",
};

export default function CropEditor({ imageUrl, naturalWidth, naturalHeight, ratios, onConfirm, onCancel }: Props) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [positions, setPositions] = useState<Record<string, { panX: number; panY: number }>>(() => {
        const init: Record<string, { panX: number; panY: number }> = {};
        for (const r of ratios) init[r] = { panX: 0.5, panY: 0.5 };
        return init;
    });

    const activeRatio = ratios[activeIndex];
    const pos = positions[activeRatio];

    // Drag state
    const containerRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0, startPanX: 0, startPanY: 0 });

    const crop = computeCrop(naturalWidth, naturalHeight, activeRatio, pos.panX, pos.panY);

    // Displayed dimensions — fit within editor box
    const EDITOR_W = 480;
    const EDITOR_H = 360;
    const displayScale = Math.min(EDITOR_W / naturalWidth, EDITOR_H / naturalHeight, 1);
    const imgW = naturalWidth * displayScale;
    const imgH = naturalHeight * displayScale;
    const cropW = crop.w * displayScale;
    const cropH = crop.h * displayScale;
    const cropX = crop.x * displayScale;
    const cropY = crop.y * displayScale;

    // Max px the crop rect can slide (in display space)
    const maxSlideX = imgW - cropW;
    const maxSlideY = imgH - cropH;

    const updatePan = useCallback((panX: number, panY: number) => {
        setPositions(prev => ({
            ...prev,
            [activeRatio]: {
                panX: Math.max(0, Math.min(1, panX)),
                panY: Math.max(0, Math.min(1, panY)),
            }
        }));
    }, [activeRatio]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        dragging.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY, startPanX: pos.panX, startPanY: pos.panY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }, [pos]);

    useEffect(() => {
        function onPointerMove(e: PointerEvent) {
            if (!dragging.current) return;
            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;
            const dpx = maxSlideX > 0 ? dx / maxSlideX : 0;
            const dpy = maxSlideY > 0 ? dy / maxSlideY : 0;
            updatePan(dragStart.current.startPanX + dpx, dragStart.current.startPanY + dpy);
        }
        function onPointerUp() { dragging.current = false; }
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [maxSlideX, maxSlideY, updatePan]);

    function handleConfirm() {
        const out: Record<AspectRatio, { panX: number; panY: number }> = {} as any;
        for (const r of ratios) out[r] = positions[r];
        onConfirm(out);
    }

    return (
        <div className="overlay" onClick={onCancel}>
            <div className="crop-editor" onClick={e => e.stopPropagation()}>
                <div className="crop-editor-header">
                    <h2>Upravit ořez</h2>
                    <div className="crop-tabs">
                        {ratios.map((r, i) => (
                            <button
                                key={r}
                                className={`crop-tab ${i === activeIndex ? "crop-tab-active" : ""}`}
                                onClick={() => setActiveIndex(i)}
                            >
                                {RATIO_LABELS[r]}
                            </button>
                        ))}
                    </div>
                </div>

                <div
                    className="crop-canvas-wrap"
                    ref={containerRef}
                    style={{ width: imgW, height: imgH }}
                >
                    <img
                        src={imageUrl}
                        className="crop-canvas-img"
                        style={{ width: imgW, height: imgH }}
                        draggable={false}
                    />

                    {/* Dark overlay — 4 rects around the crop */}
                    <div className="crop-dim crop-dim-top" style={{ width: imgW, height: cropY }} />
                    <div className="crop-dim crop-dim-bottom" style={{ width: imgW, height: imgH - cropY - cropH, top: cropY + cropH }} />
                    <div className="crop-dim crop-dim-left" style={{ width: cropX, height: cropH, top: cropY }} />
                    <div className="crop-dim crop-dim-right" style={{ width: imgW - cropX - cropW, height: cropH, top: cropY, left: cropX + cropW }} />

                    {/* Crop frame — draggable */}
                    <div
                        className="crop-frame"
                        style={{ left: cropX, top: cropY, width: cropW, height: cropH }}
                        onPointerDown={onPointerDown}
                    >
                        {/* Grid lines */}
                        <div className="crop-grid-h" style={{ top: "33.33%" }} />
                        <div className="crop-grid-h" style={{ top: "66.66%" }} />
                        <div className="crop-grid-v" style={{ left: "33.33%" }} />
                        <div className="crop-grid-v" style={{ left: "66.66%" }} />
                        {/* Corner handles */}
                        <div className="crop-corner crop-corner-tl" />
                        <div className="crop-corner crop-corner-tr" />
                        <div className="crop-corner crop-corner-bl" />
                        <div className="crop-corner crop-corner-br" />
                    </div>
                </div>

                <p className="crop-hint">Přetáhni rámeček pro změnu pozice ořezu</p>

                <div className="dialog-actions">
                    <button className="btn btn-ghost" onClick={onCancel}>Zrušit</button>
                    <button className="btn btn-primary" onClick={handleConfirm}>
                        Konvertovat ({ratios.length})
                    </button>
                </div>
            </div>
        </div>
    );
}
