"use client";

// Renders every page of a PDF (fetched from `src`) to a canvas, sized to the
// container width, and lets the parent overlay absolutely-positioned children
// per page (fields). Page geometry is reported in CSS pixels so overlays can
// convert fraction coordinates (0–1) ↔ pixels. pdf.js is loaded lazily; its
// worker is served from /pdf.worker.min.mjs (copied at build time).
import { useEffect, useRef, useState, type ReactNode } from "react";

export type PageGeom = { index: number; width: number; height: number };

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<unknown> } }> };

export function PdfPages({ src, maxWidth = 860, renderOverlay, onPages, onPageClick }: {
  src: string;
  maxWidth?: number;
  renderOverlay?: (page: PageGeom) => ReactNode;
  onPages?: (pages: PageGeom[]) => void;
  onPageClick?: (page: PageGeom, fx: number, fy: number) => void; // fractions of the page
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [pages, setPages] = useState<PageGeom[]>([]);
  const [error, setError] = useState("");
  const [width, setWidth] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  // 1. Track the available width (responsive).
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => setWidth(Math.min(maxWidth, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [maxWidth]);

  // 2. Load the document once.
  useEffect(() => {
    let cancelled = false;
    setDoc(null); setPages([]); setError("");
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const res = await fetch(src, { credentials: "same-origin" });
        if (!res.ok) throw new Error("Could not load the document");
        const loaded = await pdfjs.getDocument({ data: await res.arrayBuffer() }).promise;
        if (!cancelled) setDoc(loaded as unknown as PdfDoc);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load the document");
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  // 3. Measure every page at the current width.
  useEffect(() => {
    if (!doc || !width) return;
    let cancelled = false;
    (async () => {
      const geoms: PageGeom[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const base = (await doc.getPage(i)).getViewport({ scale: 1 });
        geoms.push({ index: i, width, height: Math.round(base.height * (width / base.width)) });
      }
      if (cancelled) return;
      setPages(geoms);
      onPages?.(geoms);
    })();
    return () => { cancelled = true; };
  }, [doc, width]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Draw — runs after the commit that created the canvases, so they exist.
  useEffect(() => {
    if (!doc || pages.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        for (const p of pages) {
          if (cancelled) return;
          const canvas = canvasRefs.current[p.index - 1];
          if (!canvas) continue;
          const page = await doc.getPage(p.index);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (p.width / base.width) * dpr });
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          canvas.style.width = `${p.width}px`;
          canvas.style.height = `${p.height}px`;
          const ctx = canvas.getContext("2d");
          if (ctx) await page.render({ canvasContext: ctx, viewport }).promise;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not render the document");
      }
    })();
    return () => { cancelled = true; };
  }, [doc, pages]);

  return (
    <div ref={hostRef} className="w-full">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!error && pages.length === 0 && <p className="text-sm text-slate-400">Loading document…</p>}
      {pages.map((p) => (
        <div
          key={p.index}
          className="relative mx-auto mb-6 bg-white shadow-sm border border-slate-200 select-none"
          style={{ width: p.width, height: p.height }}
          onClick={(e) => {
            if (!onPageClick || (e.target !== e.currentTarget && (e.target as HTMLElement).tagName !== "CANVAS")) return;
            const r = e.currentTarget.getBoundingClientRect();
            onPageClick(p, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
          }}
        >
          <canvas ref={(el) => { canvasRefs.current[p.index - 1] = el; }} className="block" />
          <div className="absolute inset-0 pointer-events-none">{renderOverlay?.(p)}</div>
          <div className="absolute -bottom-5 left-0 right-0 text-center text-[10px] text-slate-400">Page {p.index} of {pages.length}</div>
        </div>
      ))}
    </div>
  );
}
