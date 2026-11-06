"use client";

// "Adopt your signature" — draw with mouse/finger, or type and pick a script
// style. Produces a transparent PNG data URL, exactly like DocuSign's adopt
// dialog. The drawn canvas is trimmed to the ink's bounding box.
import { useEffect, useRef, useState } from "react";

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

export function SignaturePad({ kind, defaultText, onAdopt, onClose }: { kind: "signature" | "initials"; defaultText: string; onAdopt: (dataUrl: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"draw" | "type">("draw");
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
        <p className="text-xs text-slate-500 mt-1 mb-3">Draw it or type it. It will be applied to every {kind} field assigned to you.</p>
        <div className="flex gap-1 mb-3">
          {(["draw", "type"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`text-xs font-medium px-3 py-1.5 rounded ${tab === t ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}>{t === "draw" ? "Draw" : "Type"}</button>
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
        <label className="flex items-start gap-2 text-[11px] text-slate-500 mt-4">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
          I agree that this electronic {kind} is the legal equivalent of my handwritten {kind} on this document.
        </label>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 px-4 py-2 rounded-md hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={adopt} disabled={!agreed || (tab === "draw" ? !hasInk : !text.trim())} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40">Adopt and sign</button>
        </div>
      </div>
    </div>
  );
}
