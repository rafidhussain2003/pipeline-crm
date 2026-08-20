"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Ziplod Secure Notepad — a deliberately minimal, Windows-Notepad-feel editor.
//
// PERFORMANCE: one plain <textarea>. Native typing, selection, copy/cut/
// paste, Ctrl+A/C/V/Z/Y and newlines — zero per-keystroke work beyond React
// state, so typing latency is the browser's own.
//
// SECURITY: the server detects and redacts sensitive values (SSN / DOB /
// payment cards / driver's-license & state-ID numbers / bank routing &
// account numbers) on every save — this page merely displays what the server
// returns. Nothing is EVER written to localStorage / sessionStorage /
// IndexedDB / the URL; unsaved work lives in memory only, protected by an
// on-close warning while a save is pending. When the server redacts, the
// text updates to the protected placeholders and a small notice appears.
//
// AUTOSAVE: debounced (~800ms after the last keystroke), serialized (one
// request in flight; the newest content always wins), version-checked
// (another tab's newer save is never overwritten — the newer copy loads
// instead). OFFLINE: work continues in memory, an Offline chip shows, and
// saving resumes automatically when the connection returns.

type Status = "loading" | "saved" | "saving" | "dirty" | "offline" | "error" | "disabled";

export default function SecureNotepadPage() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [notice, setNotice] = useState("");
  const [fatal, setFatal] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");

  const versionRef = useRef(0);
  const textRef = useRef("");
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);

  const flashNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 5000);
  };

  // ── Load ──
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/notepad", { cache: "no-store" });
        if (res.status === 401) {
          setFatal("Please sign in to Ziplod first, then reopen the Secure Notepad.");
          setStatus("error");
          return;
        }
        if (res.status === 403) {
          const d = await res.json().catch(() => ({}));
          setFatal(d.error || "You do not have access to the Secure Notepad.");
          setStatus("disabled");
          return;
        }
        if (!res.ok) throw new Error();
        const d = await res.json();
        versionRef.current = d.version;
        textRef.current = d.content;
        setText(d.content);
        setStatus("saved");
      } catch {
        setFatal("Could not load your notepad. Check your connection and reload.");
        setStatus("error");
      }
    })();
  }, []);

  // ── Save pipeline ──
  const save = useCallback(async () => {
    if (savingRef.current) return; // one in flight; a queued change re-triggers below
    if (!dirtyRef.current) return;
    if (!navigator.onLine) {
      setStatus("offline");
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    const snapshot = textRef.current;
    setStatus("saving");
    try {
      const res = await fetch("/api/notepad", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: snapshot, version: versionRef.current }),
      });
      if (res.status === 409) {
        // Another tab saved a newer copy — load it rather than clobber it.
        const d = await res.json();
        versionRef.current = d.version;
        if (!dirtyRef.current) {
          textRef.current = d.content;
          setText(d.content);
        }
        flashNotice("This note was updated in another tab — showing the latest copy.");
        setStatus("saved");
        return;
      }
      if (!res.ok) throw new Error();
      const d = await res.json();
      versionRef.current = d.version;
      if (d.redactions > 0) {
        // The server protected sensitive values: adopt the sanitized text.
        // Only swap wholesale if the user hasn't typed since this snapshot;
        // otherwise splice is unsafe — mark dirty so the next save re-syncs.
        if (textRef.current === snapshot) {
          const ta = taRef.current;
          const atEnd = ta ? ta.selectionStart === snapshot.length : false;
          textRef.current = d.content;
          setText(d.content);
          if (ta && atEnd) requestAnimationFrame(() => ta.setSelectionRange(d.content.length, d.content.length));
        } else {
          dirtyRef.current = true;
        }
        flashNotice(`Ziplod protected ${d.redactions} sensitive ${d.redactions === 1 ? "item" : "items"} (SSN / DOB / card / ID / bank).`);
      }
      setStatus(dirtyRef.current ? "dirty" : "saved");
    } catch {
      dirtyRef.current = true;
      setStatus(navigator.onLine ? "error" : "offline");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(save, 900);
      }
    }
  }, []);

  const onChange = (v: string) => {
    textRef.current = v;
    setText(v);
    dirtyRef.current = true;
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, 800);
  };

  // ── Offline / reconnect / close-guard ──
  useEffect(() => {
    const onOnline = () => {
      if (dirtyRef.current) save();
      else setStatus((s) => (s === "offline" ? "saved" : s));
    };
    const onOffline = () => setStatus("offline");
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) e.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeunload", onBeforeUnload);
    // Retry loop while offline/error with pending work (memory only — nothing
    // is ever placed in browser storage).
    const retry = setInterval(() => {
      if (dirtyRef.current && !savingRef.current && navigator.onLine) save();
    }, 5000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(retry);
    };
  }, [save]);

  // ── Find (Ctrl+F) — selects the next match in the textarea ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findRef.current?.focus());
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        taRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);

  const findNext = () => {
    const ta = taRef.current;
    if (!ta || !findQ) return;
    const hay = textRef.current.toLowerCase();
    const needle = findQ.toLowerCase();
    const from = ta.selectionEnd || 0;
    let idx = hay.indexOf(needle, from);
    if (idx === -1) idx = hay.indexOf(needle); // wrap around
    if (idx === -1) {
      flashNotice("Not found.");
      return;
    }
    ta.focus();
    ta.setSelectionRange(idx, idx + findQ.length);
  };

  const chip =
    status === "saved" ? { t: "Saved ✓", c: "text-emerald-700 bg-emerald-50 border-emerald-200" }
    : status === "saving" ? { t: "Saving…", c: "text-slate-600 bg-slate-100 border-slate-200" }
    : status === "dirty" ? { t: "Unsaved…", c: "text-slate-600 bg-slate-100 border-slate-200" }
    : status === "offline" ? { t: "Offline — will save when back", c: "text-amber-800 bg-amber-50 border-amber-200" }
    : status === "loading" ? { t: "Loading…", c: "text-slate-500 bg-slate-100 border-slate-200" }
    : { t: "Save failed — retrying", c: "text-red-700 bg-red-50 border-red-200" };

  if (fatal) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-5 py-4 max-w-md text-center">{fatal}</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* Minimal top bar — the whole chrome. */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-slate-50 shrink-0">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-slate-900 text-white text-xs font-bold shrink-0">Z</span>
        <span className="text-sm font-semibold text-slate-800">Secure Notepad</span>
        <span className={`text-[11px] font-medium border rounded-full px-2.5 py-0.5 ${chip.c}`}>{chip.t}</span>
        {notice && <span className="text-[11px] font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 truncate">{notice}</span>}
        <span className="ml-auto text-[11px] text-slate-400 hidden sm:block">SSNs, DOBs, cards, license/IDs & bank numbers are protected automatically · Ctrl+F to search</span>
      </div>

      {findOpen && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-slate-200 bg-white shrink-0">
          <input
            ref={findRef}
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && findNext()}
            placeholder="Find…"
            className="w-64 rounded-md border border-slate-200 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={findNext} className="text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded px-2.5 py-1">Next</button>
          <button onClick={() => { setFindOpen(false); taRef.current?.focus(); }} className="text-xs text-slate-400 hover:text-slate-600 px-1">✕</button>
        </div>
      )}

      {/* The editor — a plain, fast textarea. */}
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        disabled={status === "loading"}
        spellCheck={false}
        placeholder="Type your notes here…"
        className="flex-1 w-full resize-none p-4 font-mono text-[13.5px] leading-relaxed text-slate-900 focus:outline-none disabled:bg-slate-50"
      />
    </div>
  );
}
