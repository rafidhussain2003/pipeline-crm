"use client";

import { useEffect, useRef, useState } from "react";

// Bulk-copy protection for AGENTS on the leads list (security enhancement —
// data-exfiltration guardrail). Mounted only when the viewer is an agent, so
// admins/managers are never affected.
//
// It deliberately changes NOTHING about the page's look or normal workflow.
// A single field — one lead's name, phone or email — still copies exactly as
// before (short, single-cell selections pass straight through, and copies
// from inputs like the search box aren't even seen: the browser keeps those
// in a separate selection). What it blocks is a copy/cut whose selection
// spans MULTIPLE leads: a click-drag across rows, a Select-All, the whole
// table. Those are cancelled, the user sees a brief note, and a throttled,
// best-effort security event is recorded server-side.
//
// Heuristic for "bulk": copying across table cells/rows always yields tab or
// newline separators (a lone field has neither), or the selection visibly
// covers more than one table row, or the text is far longer than any single
// contact field. Any of those ⇒ block.
const SINGLE_FIELD_MAX = 120; // a name / phone / email fits comfortably under this
const REPORT_THROTTLE_MS = 10_000;

export default function AgentCopyGuard() {
  const [notice, setNotice] = useState(false);
  const lastReport = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function spansMultipleRows(sel: Selection): boolean {
      if (sel.rangeCount === 0) return false;
      const node = sel.getRangeAt(0).commonAncestorContainer;
      const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null;
      const table = el?.closest?.("table");
      const rows = table?.querySelectorAll("tbody tr");
      if (!rows || rows.length === 0) return false;
      let touched = 0;
      rows.forEach((tr) => {
        if (sel.containsNode(tr, true)) touched++;
      });
      return touched > 1;
    }

    function isBulk(text: string, sel: Selection | null): boolean {
      if (!text) return false; // nothing / input-field copy → not our concern
      if (/[\t\n\r]/.test(text)) return true; // multiple cells always carry separators
      if (text.length > SINGLE_FIELD_MAX) return true; // far bigger than any one field
      if (sel && spansMultipleRows(sel)) return true; // covers >1 lead row
      return false;
    }

    function onCopyOrCut(e: ClipboardEvent) {
      const sel = window.getSelection();
      const text = sel?.toString() ?? "";
      if (!isBulk(text, sel)) return; // single field / normal → allow (do nothing)

      // Block: cancel the copy so nothing reaches the clipboard. We leave the
      // user's existing clipboard untouched (no setData) rather than wiping it.
      e.preventDefault();

      setNotice(true);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(false), 2600);

      const now = Date.now();
      if (now - lastReport.current > REPORT_THROTTLE_MS) {
        lastReport.current = now;
        try {
          fetch("/api/security/lead-copy-blocked", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chars: text.length }),
            keepalive: true,
          }).catch(() => {});
        } catch {
          /* best-effort only */
        }
      }
    }

    // Capture phase so we run before any bubbling handler and can cancel.
    document.addEventListener("copy", onCopyOrCut, true);
    document.addEventListener("cut", onCopyOrCut, true);
    return () => {
      document.removeEventListener("copy", onCopyOrCut, true);
      document.removeEventListener("cut", onCopyOrCut, true);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  if (!notice) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-lg"
    >
      Copying multiple leads at once is disabled. You can still copy a single lead&rsquo;s phone, email or name.
    </div>
  );
}
