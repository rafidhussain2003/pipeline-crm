"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ZiplodMark } from "@/components/brand/ZiplodMark";

// Ziplod Secure Notepad — a minimal, Windows-Notepad-feel editor with TABS.
//
// Each agent has many named tabs; the tab bar adds / switches / renames /
// closes them. The editor is a plain <textarea> (native typing/paste/undo,
// Ctrl+F search), so typing latency is the browser's own.
//
// SECURITY: the server detects sensitive values (SSN / DOB / card / license-ID
// / bank) and keeps them readable for a retention window — 12h after typing by
// default, 7 days if the block has a "Follow Up" line, or erased at once on an
// "Active" line — then auto-erases (DOB keeps its birth year). Values are
// stored ENCRYPTED at rest and returned only to the owning agent. Nothing is
// ever written to localStorage / sessionStorage / IndexedDB / the URL.
//
// AUTOSAVE per tab: debounced (~800ms), serialized, version-checked. Switching
// tabs flushes the current tab first, then loads the next.

type Status = "loading" | "saved" | "saving" | "dirty" | "offline" | "error";
type Tab = { id: string; title: string; position: number };

export default function SecureNotepadPage() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [notice, setNotice] = useState("");
  const [fatal, setFatal] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [matchPos, setMatchPos] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const tabsRef = useRef<Tab[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const textRef = useRef("");
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const reloadRef = useRef<() => void>(() => {}); // set to bootstrap() below (breaks the load/bootstrap cycle)

  const flashNotice = (msg: string) => {
    setNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 5000);
  };
  const syncTabs = (next: Tab[]) => {
    tabsRef.current = next;
    setTabs(next);
  };

  // ── Load one tab's content ──
  const loadTab = useCallback(async (id: string) => {
    setStatus("loading");
    try {
      const res = await fetch(`/api/notepad/${id}`, { cache: "no-store" });
      if (res.status === 401) return setFatal("Please sign in to Ziplod first, then reopen the Secure Notepad.");
      if (res.status === 403) return setFatal((await res.json().catch(() => ({}))).error || "You do not have access to the Secure Notepad.");
      if (res.status === 404) {
        // Tab vanished (deleted elsewhere) — refresh the list.
        reloadRef.current();
        return;
      }
      if (!res.ok) throw new Error();
      const d = await res.json();
      versionRef.current = d.version;
      textRef.current = d.content;
      setText(d.content);
      setStatus("saved");
    } catch {
      setStatus("error");
      flashNotice("Could not load this tab. Check your connection.");
    }
  }, []);

  // ── Initial load: tab list + first tab's content ──
  const bootstrap = useCallback(async () => {
    try {
      const res = await fetch("/api/notepad", { cache: "no-store" });
      if (res.status === 401) return setFatal("Please sign in to Ziplod first, then reopen the Secure Notepad.");
      if (res.status === 403) return setFatal((await res.json().catch(() => ({}))).error || "You do not have access to the Secure Notepad.");
      if (!res.ok) throw new Error();
      const d = await res.json();
      const list: Tab[] = d.tabs || [];
      syncTabs(list);
      const first = list.find((t) => t.id === activeIdRef.current) || list[0];
      if (first) {
        activeIdRef.current = first.id;
        setActiveId(first.id);
        dirtyRef.current = false;
        await loadTab(first.id);
      }
    } catch {
      setFatal("Could not load your notepad. Check your connection and reload.");
    }
  }, [loadTab]);

  useEffect(() => {
    reloadRef.current = bootstrap;
    bootstrap();
  }, [bootstrap]);

  // ── Save the ACTIVE tab (debounced autosave target) ──
  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (!dirtyRef.current) return;
    const id = activeIdRef.current;
    if (!id) return;
    if (!navigator.onLine) return setStatus("offline");
    savingRef.current = true;
    dirtyRef.current = false;
    const snapshot = textRef.current;
    setStatus("saving");
    try {
      const res = await fetch(`/api/notepad/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: snapshot, version: versionRef.current }),
      });
      const stillActive = activeIdRef.current === id;
      if (res.status === 409) {
        const d = await res.json();
        if (stillActive) {
          versionRef.current = d.version;
          if (!dirtyRef.current) {
            textRef.current = d.content;
            setText(d.content);
          }
          flashNotice("This tab was updated elsewhere — showing the latest copy.");
          setStatus("saved");
        }
        return;
      }
      if (!res.ok) throw new Error();
      const d = await res.json();
      if (stillActive) {
        versionRef.current = d.version;
        if (d.expired > 0) {
          if (textRef.current === snapshot) {
            const ta = taRef.current;
            const atEnd = ta ? ta.selectionStart === snapshot.length : false;
            textRef.current = d.content;
            setText(d.content);
            if (ta && atEnd) requestAnimationFrame(() => ta.setSelectionRange(d.content.length, d.content.length));
          } else {
            dirtyRef.current = true;
          }
          flashNotice(`${d.expired} expired sensitive ${d.expired === 1 ? "item" : "items"} auto-erased.`);
        }
        setStatus(dirtyRef.current ? "dirty" : "saved");
      }
    } catch {
      dirtyRef.current = true;
      setStatus(navigator.onLine ? "error" : "offline");
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && activeIdRef.current === id) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(save, 900);
      }
    }
  }, []);

  // Flush any pending/in-flight save before switching or closing tabs.
  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    while (savingRef.current) await new Promise((r) => setTimeout(r, 40));
    if (dirtyRef.current && navigator.onLine) await save();
    while (savingRef.current) await new Promise((r) => setTimeout(r, 40));
  }, [save]);

  const onChange = (v: string) => {
    textRef.current = v;
    setText(v);
    dirtyRef.current = true;
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, 800);
  };

  // ── Tab actions ──
  const switchTab = useCallback(async (id: string) => {
    if (id === activeIdRef.current) return;
    await flush();
    activeIdRef.current = id;
    setActiveId(id);
    dirtyRef.current = false;
    await loadTab(id);
    requestAnimationFrame(() => taRef.current?.focus());
  }, [flush, loadTab]);

  const addTab = useCallback(async () => {
    await flush();
    const res = await fetch("/api/notepad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    if (!res.ok) return flashNotice((await res.json().catch(() => ({}))).error || "Could not add a tab.");
    const { tab } = await res.json();
    syncTabs([...tabsRef.current, tab]);
    activeIdRef.current = tab.id;
    setActiveId(tab.id);
    dirtyRef.current = false;
    versionRef.current = 1;
    textRef.current = "";
    setText("");
    setStatus("saved");
    requestAnimationFrame(() => taRef.current?.focus());
  }, [flush]);

  const closeTab = useCallback(async (id: string) => {
    const t = tabsRef.current.find((x) => x.id === id);
    if (!confirm(`Close "${t?.title || "this tab"}"? Its contents are permanently deleted.`)) return;
    await fetch(`/api/notepad/${id}`, { method: "DELETE" });
    const remaining = tabsRef.current.filter((x) => x.id !== id);
    syncTabs(remaining);
    if (activeIdRef.current === id) {
      dirtyRef.current = false;
      if (remaining.length > 0) {
        activeIdRef.current = remaining[0].id;
        setActiveId(remaining[0].id);
        await loadTab(remaining[0].id);
      } else {
        activeIdRef.current = null;
        await bootstrap(); // re-seeds a fresh "Note 1"
      }
    }
  }, [loadTab, bootstrap]);

  const commitRename = useCallback(async (id: string) => {
    const title = editTitle.trim().replace(/[\r\n]+/g, " ").slice(0, 200);
    setEditingId(null);
    if (!title) return;
    syncTabs(tabsRef.current.map((t) => (t.id === id ? { ...t, title } : t)));
    await fetch(`/api/notepad/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
  }, [editTitle]);

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

  // ── Find (Ctrl+F) — works like a normal notepad: search-as-you-type, a
  //    match counter, and up/down navigation through every occurrence. ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        // Pre-fill the box with the current selection (like a real editor).
        const ta = taRef.current;
        const sel = ta && ta.selectionStart !== ta.selectionEnd ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : "";
        if (sel && !sel.includes("\n")) setFindQ(sel);
        setFindOpen(true);
        requestAnimationFrame(() => {
          findRef.current?.focus();
          findRef.current?.select();
        });
      }
      if (e.key === "Escape" && findOpen) {
        setFindOpen(false);
        taRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [findOpen]);

  // ── Block LOCAL SAVE of the notepad ──────────────────────────────────────
  // The notepad holds customer PII readable for its retention window, so an
  // agent must not be able to write the page to disk. Intercept Ctrl/Cmd+S and
  // Ctrl/Cmd+Shift+S ("Save page as") and Ctrl/Cmd+P (print / Save-as-PDF — the
  // same exfiltration path) in the CAPTURE phase and cancel the browser default.
  // (This blocks the keyboard shortcuts; the browser's own ⋮ menu "Save/Print"
  // can't be disabled by a web page — that limit is documented for the owner.)
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === "s" || k === "p")) {
        e.preventDefault();
        e.stopPropagation();
        setNotice(k === "s" ? "Saving this notepad to your computer is disabled." : "Printing this notepad is disabled.");
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = setTimeout(() => setNotice(""), 4000);
      }
    };
    window.addEventListener("keydown", block, { capture: true });
    return () => window.removeEventListener("keydown", block, { capture: true });
  }, []);

  // Every match position for the current query (case-insensitive).
  const matches = useMemo(() => {
    if (!findQ) return [] as number[];
    const hay = text.toLowerCase();
    const needle = findQ.toLowerCase();
    const out: number[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push(i);
      i = hay.indexOf(needle, i + Math.max(1, needle.length));
    }
    return out;
  }, [findQ, text]);

  // Select + scroll a match into view WITHOUT stealing focus from the find box
  // (so the user can keep typing / pressing the arrows). The selection shows on
  // the textarea; closing the bar re-focuses it and the match highlights fully.
  const goToMatch = useCallback(
    (pos: number) => {
      const ta = taRef.current;
      if (!ta || matches.length === 0) return;
      const p = ((pos % matches.length) + matches.length) % matches.length;
      setMatchPos(p);
      const idx = matches[p];
      ta.setSelectionRange(idx, idx + findQ.length);
      const line = text.slice(0, idx).split("\n").length - 1;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
      if (backdropRef.current) backdropRef.current.scrollTop = ta.scrollTop; // keep the highlight aligned
    },
    [matches, findQ, text]
  );
  const findNext = useCallback(() => goToMatch(matchPos + 1), [goToMatch, matchPos]);
  const findPrev = useCallback(() => goToMatch(matchPos - 1), [goToMatch, matchPos]);

  // Blue highlight overlay: every match is painted behind the text (current
  // match darker), so it shows in true blue whether or not the textarea is
  // focused — the textarea sits transparently on top, this div mirrors it.
  const highlightNodes = useMemo<ReactNode>(() => {
    if (!findOpen || !findQ || matches.length === 0) return null;
    const len = findQ.length;
    const cur = matchPos % matches.length;
    const parts: ReactNode[] = [];
    let cursor = 0;
    matches.forEach((start, i) => {
      if (start > cursor) parts.push(text.slice(cursor, start));
      parts.push(
        <mark key={i} className={`rounded-[2px] text-transparent ${i === cur ? "bg-blue-400" : "bg-blue-200"}`}>
          {text.slice(start, start + len)}
        </mark>
      );
      cursor = start + len;
    });
    parts.push(text.slice(cursor));
    return parts;
  }, [findOpen, findQ, matches, matchPos, text]);

  // Jump to the first match as the query changes (search-as-you-type). Keyed on
  // findQ only, so editing the note doesn't yank the cursor around.
  useEffect(() => {
    if (findOpen && findQ && matches.length > 0) goToMatch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQ]);

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
      {/* Tab bar */}
      <div className="flex items-stretch gap-1 px-2 pt-1.5 bg-slate-100 border-b border-slate-200 overflow-x-auto shrink-0">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            <div
              key={t.id}
              onClick={() => switchTab(t.id)}
              onDoubleClick={() => { setEditingId(t.id); setEditTitle(t.title); }}
              className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-xs font-medium cursor-pointer max-w-[200px] shrink-0 ${
                active ? "bg-white text-slate-900 border border-b-white border-slate-200" : "bg-slate-200/60 text-slate-600 hover:bg-slate-200"
              }`}
              title={t.title}
            >
              {editingId === t.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(t.id); if (e.key === "Escape") setEditingId(null); }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-28 bg-white border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none"
                />
              ) : (
                <span className="truncate">{t.title}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
                className="text-slate-400 hover:text-red-600 opacity-60 group-hover:opacity-100 shrink-0"
                aria-label="Close tab"
              >
                ×
              </button>
            </div>
          );
        })}
        <button onClick={addTab} className="px-2.5 py-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200 rounded-md text-sm shrink-0" aria-label="New tab" title="New tab">+</button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b border-slate-200 bg-slate-50 shrink-0">
        <ZiplodMark className="w-5 h-5 shrink-0" />
        <span className="text-xs font-semibold text-slate-800">Secure Notepad</span>
        <span className={`text-[11px] font-medium border rounded-full px-2.5 py-0.5 ${chip.c}`}>{chip.t}</span>
        {notice && <span className="text-[11px] font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5 truncate">{notice}</span>}
        <span className="ml-auto text-[11px] text-slate-400 hidden md:block">Double-click a tab to rename · Ctrl+F to search</span>
      </div>

      {/* Retention legend — always visible so agents remember how long sensitive
          info (SSN · card · DOB · license/ID · bank) is kept before it auto-erases. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1 border-b border-slate-200 bg-white text-[11px] shrink-0">
        <span className="font-semibold text-slate-500">Sensitive info auto-erases:</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-700 px-2 py-0.5">
          Default <b>12 hours</b>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5">
          Type <b>{'"Follow Up"'}</b> on its own line → keeps <b>7 days</b>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5">
          Type <b>{'"Active"'}</b> on its own line → erases <b>now</b>
        </span>
        <span className="text-slate-400 hidden lg:inline">· leave a blank line between customers</span>
      </div>

      {findOpen && (
        <div className="flex items-center gap-1.5 px-4 py-1.5 border-b border-slate-200 bg-white shrink-0">
          <input
            ref={findRef}
            value={findQ}
            onChange={(e) => setFindQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) findPrev();
                else findNext();
              } else if (e.key === "Escape") {
                setFindOpen(false);
                taRef.current?.focus();
              }
            }}
            placeholder="Find in note…"
            className="w-64 rounded-md border border-slate-200 px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-[11px] tabular-nums text-slate-500 min-w-[64px] text-center select-none">
            {findQ ? (matches.length > 0 ? `${(matchPos % matches.length) + 1} / ${matches.length}` : "No results") : ""}
          </span>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={findPrev}
            disabled={matches.length === 0}
            title="Previous match (Shift+Enter)"
            className="w-7 h-7 inline-flex items-center justify-center rounded border border-slate-300 text-slate-800 text-sm font-bold hover:bg-slate-100 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={findNext}
            disabled={matches.length === 0}
            title="Next match (Enter)"
            className="w-7 h-7 inline-flex items-center justify-center rounded border border-slate-300 text-slate-800 text-sm font-bold hover:bg-slate-100 disabled:opacity-30"
          >
            ↓
          </button>
          <button
            onClick={() => { setFindOpen(false); taRef.current?.focus(); }}
            title="Close (Esc)"
            className="w-7 h-7 inline-flex items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>
      )}

      <div className="relative flex-1 min-h-0 bg-white">
        {highlightNodes && (
          <div
            ref={backdropRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden p-4 font-mono text-[13.5px] leading-relaxed whitespace-pre-wrap break-words text-transparent [scrollbar-gutter:stable]"
          >
            {highlightNodes}
          </div>
        )}
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onScroll={(e) => {
            const b = backdropRef.current;
            if (b) {
              b.scrollTop = e.currentTarget.scrollTop;
              b.scrollLeft = e.currentTarget.scrollLeft;
            }
          }}
          disabled={status === "loading"}
          spellCheck={false}
          placeholder="Type your notes here…"
          className="absolute inset-0 w-full h-full resize-none p-4 font-mono text-[13.5px] leading-relaxed text-slate-900 bg-transparent focus:outline-none disabled:bg-slate-50 [scrollbar-gutter:stable]"
        />
      </div>
    </div>
  );
}
