"use client";

// "Adopt your signature" — draw with mouse/finger, type and pick a script
// style, or upload a picture of your signature. Produces a transparent PNG
// data URL, exactly like DocuSign's adopt dialog. The result is trimmed to
// the ink's bounding box and previewed inside the DocuSign-style stamp.
import { useEffect, useRef, useState } from "react";
import { STAMP_COLOR } from "./shared";

const FONTS = ['"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive', '"Lucida Handwriting", "Apple Chancery", cursive', 'Georgia, "Times New Roman", serif'];

function trim(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const img = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (img[(y * width + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return "";
  const pad = 8;
  const out = document.createElement("canvas");
  out.width = maxX - minX + 1 + pad * 2;
  out.height = maxY - minY + 1 + pad * 2;
  out.getContext("2d")!.drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

// An uploaded photo/scan: scale down, knock out the (near-)white paper so the
// ink sits on a transparent background, then trim.
function uploadedToPng(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 900 / img.width, 400 / img.height);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      for (let i = 0; i < px.length; i += 4) {
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (lum > 200) px[i + 3] = 0; // paper → transparent
        else { px[i] = 11; px[i + 1] = 26; px[i + 2] = 107; px[i + 3] = Math.min(255, Math.round((225 - lum) * 1.6)); } // ink → signature blue
      }
      ctx.putImageData(d, 0, 0);
      resolve(trim(c));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
    img.src = url;
  });
}

export function SignaturePad({ kind, defaultText, onAdopt, onClose }: { kind: "signature" | "initials"; defaultText: string; onAdopt: (dataUrl: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [uploaded, setUploaded] = useState<string>("");
  const [uploadError, setUploadError] = useState("");
  const [text, setText] = useState(defaultText);
  const [font, setFont] = useState(0);
  const [hasInk, setHasInk] = useState(false);
  const [agreed, setAgreed] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = c.clientWidth * dpr;
    c.height = c.clientHeight * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = kind === "signature" ? 2.4 : 2;
    ctx.strokeStyle = "#0b1a6b";
  }, [kind, tab]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => { e.preventDefault(); drawing.current = true; last.current = pos(e); e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p; setHasInk(true);
  };
  const up = () => { drawing.current = false; last.current = null; };
  const clear = () => { const c = canvasRef.current; if (!c) return; const ctx = c.getContext("2d")!; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); ctx.restore(); setHasInk(false); };

  function adopt() {
    if (tab === "draw") {
      const c = canvasRef.current; if (!c) return;
      const data = trim(c); if (data) onAdopt(data);
      return;
    }
    if (tab === "upload") { if (uploaded) onAdopt(uploaded); return; }
    const value = text.trim(); if (!value) return;
    const c = document.createElement("canvas");
    const size = kind === "signature" ? 64 : 56;
    const ctx = c.getContext("2d")!;
    ctx.font = `${size}px ${FONTS[font]}`;
    const w = Math.ceil(ctx.measureText(value).width) + 40;
    c.width = Math.max(w, 120); c.height = size * 1.8;
    const ctx2 = c.getContext("2d")!;
    ctx2.font = `${size}px ${FONTS[font]}`;
    ctx2.fillStyle = "#0b1a6b";
    ctx2.textBaseline = "middle";
    ctx2.fillText(value, 20, c.height / 2);
    onAdopt(trim(c) || c.toDataURL("image/png"));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-slate-900">Adopt your {kind === "signature" ? "signature" : "initials"}</h2>
        <p className="text-xs text-slate-500 mt-1 mb-3">Draw it, type it, or upload a picture of it. It will be applied to every {kind} field assigned to you.</p>
        <div className="flex gap-1 mb-3">
          {(["draw", "type", "upload"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`text-xs font-medium px-3 py-1.5 rounded ${tab === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{t === "draw" ? "Draw" : t === "type" ? "Type" : "Upload"}</button>
          ))}
        </div>
        {tab === "draw" ? (
          <div>
            <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} className="w-full h-44 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 touch-none cursor-crosshair" />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-slate-400">Sign above with your mouse or finger</span>
              <button type="button" onClick={clear} className="text-[11px] font-medium text-slate-500 hover:text-slate-800">Clear</button>
            </div>
          </div>
        ) : tab === "upload" ? (
          <div>
            <label className="flex flex-col items-center justify-center h-44 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 cursor-pointer overflow-hidden">
              {uploaded ? (
                <img src={uploaded} alt="Your uploaded signature" className="max-h-36 max-w-full object-contain" />
              ) : (
                <>
                  <span className="text-sm font-medium text-slate-700">Choose an image of your {kind}</span>
                  <span className="text-[11px] text-slate-400 mt-1">PNG or JPG · a photo or scan on white paper works best</span>
                </>
              )}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setUploadError(""); try { const png = await uploadedToPng(f); if (!png) throw new Error("No signature found in that image"); setUploaded(png); } catch (err) { setUploaded(""); setUploadError(err instanceof Error ? err.message : "Could not read that image"); } }} />
            </label>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-slate-400">{uploadError ? <span className="text-red-600">{uploadError}</span> : "The white background is removed automatically."}</span>
              {uploaded && <button type="button" onClick={() => setUploaded("")} className="text-[11px] font-medium text-slate-500 hover:text-slate-800">Remove</button>}
            </div>
          </div>
        ) : (
          <div>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={kind === "signature" ? 80 : 6} className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm mb-2" placeholder={kind === "signature" ? "Your full name" : "Initials"} />
            <div className="grid grid-cols-3 gap-2">
              {FONTS.map((f, i) => (
                <button key={i} type="button" onClick={() => setFont(i)} className={`h-16 rounded-md border px-2 overflow-hidden text-[#0b1a6b] ${font === i ? "border-slate-900 bg-slate-50" : "border-slate-200"}`} style={{ fontFamily: f, fontSize: kind === "signature" ? 26 : 24 }}>
                  {text.trim() || (kind === "signature" ? "Signature" : "AB")}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* How it will look on the document: the DocuSign-style frame. */}
        <div className="mt-4 flex items-end gap-3">
          <div className="border-l-2 pl-1.5 min-w-[150px] h-14 flex flex-col" style={{ borderColor: STAMP_COLOR }}>
            {kind === "signature" && <span className="text-[7px] leading-none font-medium" style={{ color: STAMP_COLOR }}>Signed by:</span>}
            <div className="flex-1 min-h-0 flex items-end">
              {tab === "upload" && uploaded ? <img src={uploaded} alt="" className="max-h-full max-w-[220px] object-contain object-left-bottom" /> : tab === "type" ? <span className="text-[#0b1a6b] truncate max-w-[220px]" style={{ fontFamily: FONTS[font], fontSize: kind === "signature" ? 22 : 20 }}>{text.trim() || (kind === "signature" ? "Your signature" : "AB")}</span> : <span className="text-[11px] text-slate-400">{hasInk ? "Your drawing" : "Draw above"}</span>}
            </div>
            <span className="text-[6px] leading-none tracking-wide" style={{ color: STAMP_COLOR }}>SIGNATURE ID WILL APPEAR HERE</span>
          </div>
          <span className="text-[11px] text-slate-400 pb-1">Preview of the stamp on the document</span>
        </div>
        <label className="flex items-start gap-2 text-[11px] text-slate-500 mt-4">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          I agree that this electronic {kind} is the legal equivalent of my handwritten {kind} on this document.
        </label>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={adopt} disabled={!agreed || (tab === "draw" ? !hasInk : tab === "upload" ? !uploaded : !text.trim())} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40">Adopt and sign</button>
        </div>
      </div>
    </div>
  );
}
