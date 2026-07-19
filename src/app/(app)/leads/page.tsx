"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";

type Lead = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  disposition: string;
  ownerName: string | null;
  followUpAt: string | null;
  createdAt: string;
  isDuplicate: boolean;
};

type Disposition = { id: string; label: string; color: string };

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Phase 1A: server-side pagination + bulk-selection infrastructure ---
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  // Selection is keyed by lead id rather than row index so it survives
  // re-sorting and re-fetching. Scoped to the current page: these ids are what
  // a future bulk action would operate on.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Restore the saved page size before the first fetch so a reload doesn't
  // flash 50 rows and then re-request 100.
  useEffect(() => {
    const saved = parseInt(localStorage.getItem("leads.pageSize") || "", 10);
    if ([50, 75, 100].includes(saved)) setPageSize(saved);
  }, []);

  const load = useCallback(async (opts?: { preserveSelection?: boolean; silent?: boolean }) => {
    // `silent` skips the loading state: a realtime refresh must not blank the
    // table out from under someone mid-read (Task 5 — no flickering).
    if (!opts?.silent) setLoading(true);
    setLoadError("");
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    // Previously this had no try/catch and setLoading(false) was the last
    // statement: a network failure — or a non-JSON error body, which .json()
    // throws on — rejected the promise, so the spinner never cleared and the
    // page sat on "Loading leads…" forever with no way to recover. A failed
    // response also used to fall through to `leadsData.leads || []`, showing
    // the "No leads yet" empty state as if the company genuinely had none.
    try {
      const leadsRes = await fetch(`/api/leads?${params.toString()}`);
      if (!leadsRes.ok) {
        const body = await leadsRes.json().catch(() => ({}));
        throw new Error(body.error || `Could not load leads (${leadsRes.status})`);
      }
      const leadsData = await leadsRes.json();
      setLeads(leadsData.leads || []);
      setTotal(leadsData.total ?? 0);
      setTotalPages(leadsData.totalPages ?? 1);
      if (opts?.preserveSelection) {
        // A realtime refresh keeps the user's ticked rows, but only those still
        // on the page — a lead that slid to page 2 must not stay selected
        // invisibly (Task 2 preserves work; it does not resurrect hidden state).
        const visible = new Set<string>((leadsData.leads || []).map((l: Lead) => l.id));
        setSelectedIds((prev) => new Set([...prev].filter((id) => visible.has(id))));
      } else {
        // Selection is per-page: carrying ids across a page change would let a
        // later bulk action hit rows the user can no longer see.
        setSelectedIds(new Set());
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load leads");
      setLeads([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [search, page, pageSize]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  // A narrowed search can leave you on a page that no longer exists (page 40 of
  // a 3-page result), which would render an empty table with no way back.
  useEffect(() => {
    if (!loading && page > totalPages) setPage(totalPages);
  }, [loading, page, totalPages]);

  // --- Phase 1B: realtime arrivals ---------------------------------------
  // Arrivals are COUNTED, never auto-inserted: the table only changes when the
  // user clicks View (Task 3). Nothing here touches page, search, pageSize,
  // sorting, selection or scroll (Task 2).
  const [pendingCount, setPendingCount] = useState(0);
  const [connected, setConnected] = useState(false);
  // Ids rather than a bare counter so two tabs, a reconnect replay and a live
  // push can't count the same lead twice (Task 4 — no duplicate notifications).
  const pendingIdsRef = useRef<Set<string>>(new Set());
  // Watermark for reconnect replay. Starts at mount so we only ever ask about
  // leads that arrived while this tab was actually open.
  const lastSeenAtRef = useRef<string>(new Date().toISOString());
  // load() changes identity on every keystroke; the stream must not reconnect
  // when it does, so the effect reads it through a ref.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const url = `/api/leads/stream?since=${encodeURIComponent(lastSeenAtRef.current)}`;
      es = new EventSource(url);

      es.addEventListener("ready", () => {
        attempt = 0; // a clean connect resets the backoff
        setConnected(true);
      });

      es.addEventListener("lead.created", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { leadId: string; at: string };
          if (pendingIdsRef.current.has(data.leadId)) return; // already counted
          pendingIdsRef.current.add(data.leadId);
          lastSeenAtRef.current = data.at;
          setPendingCount(pendingIdsRef.current.size);
        } catch {
          /* a malformed frame must not kill the stream */
        }
      });

      // Arrivals that happened while this tab was disconnected. Counted, not
      // listed — the exact rows come from the normal query on View.
      es.addEventListener("missed", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data) as { count: number };
          if (data.count > 0) setPendingCount((n) => n + data.count);
          lastSeenAtRef.current = new Date().toISOString();
        } catch {
          /* ignore */
        }
      });

      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        if (stopped) return;
        // EventSource retries on its own, but always to the ORIGINAL url — the
        // stale `since` would then re-report the same missed leads. Reconnect
        // manually so the watermark is current, with capped backoff.
        attempt += 1;
        retry = setTimeout(connect, Math.min(1000 * 2 ** (attempt - 1), 30_000));
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, []);

  // Insert the arrivals: re-run the CURRENT query. The server is the authority
  // on what page 1 contains, so this can't duplicate a row or shift pagination
  // — unlike splicing rows in client-side, which would double-count a lead that
  // the last fetch had already returned.
  async function showNewLeads() {
    const y = window.scrollY;
    pendingIdsRef.current.clear();
    setPendingCount(0);
    await loadRef.current({ preserveSelection: true, silent: true });
    // Same page, same page size, same row count — restore the exact offset so
    // the list doesn't jump under the cursor (Task 5).
    requestAnimationFrame(() => window.scrollTo({ top: y }));
  }

  const allOnPageSelected = leads.length > 0 && selectedIds.size === leads.length;

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelectedIds((prev) => (prev.size === leads.length ? new Set() : new Set(leads.map((l) => l.id))));
  }

  function changePageSize(next: number) {
    setPageSize(next);
    localStorage.setItem("leads.pageSize", String(next));
    // Row N of page 3 at 50/page isn't row N of page 3 at 100/page — resetting
    // to page 1 keeps the visible window meaningful.
    setPage(1);
  }

  // Up to 10 numbers, sliding so the current page stays roughly centred.
  const pageNumbers = (() => {
    const MAX = 10;
    if (totalPages <= MAX) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const start = Math.min(Math.max(1, page - Math.floor(MAX / 2)), totalPages - MAX + 1);
    return Array.from({ length: MAX }, (_, i) => start + i);
  })();

  // Dispositions are company config, not search results — previously they
  // were refetched alongside the leads on EVERY debounced keystroke (typing
  // "Omar" = 4 extra identical requests). Fetched once per page mount.
  useEffect(() => {
    fetch("/api/dispositions")
      .then(async (r) => { if (r.ok) setDispositions((await r.json()).dispositions || []); })
      .catch(() => {});
  }, []);

  async function updateDisposition(leadId: string, disposition: string) {
    // Optimistic, but it must be REVERSIBLE. Before this, a failed PATCH left
    // the new disposition on screen while the database still held the old one
    // — the agent believed the change saved and it silently had not.
    const previous = leads.find((l) => l.id === leadId)?.disposition;
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, disposition } : l)));
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save");
      setLoadError("");
    } catch (err) {
      if (previous !== undefined) setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, disposition: previous } : l)));
      setLoadError(err instanceof Error ? err.message : "Could not update that lead");
    }
  }

  function colorFor(label: string) {
    return dispositions.find((d) => d.label === label)?.color || "#64748b";
  }

  function exportCsv() {
    window.location.href = "/api/leads/export";
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult("");
    const text = await file.text();
    const res = await fetch("/api/leads/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv: text }),
    });
    const data = await res.json();
    setImporting(false);
    if (res.ok) {
      setImportResult(`Imported ${data.created} leads (${data.duplicates} flagged as possible duplicates, ${data.skipped} skipped).`);
      load();
    } else {
      setImportResult(data.error || "Import failed.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Leads CRM{" "}
            <span className="text-blue-600">
              {total.toLocaleString()} total
              {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
            </span>
            {/* Subtle, and only when something is wrong: a permanent green dot
                is noise, but silently missing live leads is worse. */}
            {!connected && (
              <span
                title="Reconnecting to live updates…"
                className="ml-2 align-middle inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
                Reconnecting
              </span>
            )}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2 disabled:opacity-40"
          >
            {importing ? "Importing…" : "Import CSV"}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" onChange={handleImportFile} className="hidden" />
          <button onClick={exportCsv} className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2">
            Export CSV
          </button>
        </div>
      </div>

      {importResult && (
        <div className="mb-4 text-sm bg-blue-50 border border-blue-100 text-blue-800 rounded-md px-3 py-2">{importResult}</div>
      )}

      {/* A failure is stated plainly and is RECOVERABLE without a page reload —
          previously any load failure was indistinguishable from "no leads". */}
      {loadError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{loadError}</span>
          <button onClick={() => load()} className="shrink-0 text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 rounded px-2.5 py-1">
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone, email"
          className="w-full max-w-md rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* New-arrival notification. Deliberately does NOT insert rows on its own
          — the user decides when the list moves under them (Task 3). */}
      {pendingCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between gap-3 mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5"
        >
          <span className="text-sm font-medium text-blue-900">
            {pendingCount === 1 ? "1 New Lead Received" : `${pendingCount.toLocaleString()} New Leads Received`}
          </span>
          <button
            onClick={showNewLeads}
            className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5"
          >
            View
          </button>
        </div>
      )}

      {/* overflow-x-auto, not overflow-hidden: this table is ~1095px wide and
          its container is ~975px at a 1280px viewport, so `hidden` silently
          CLIPPED the rightmost column (Created) with no way to reach it, and
          got worse on narrower screens. Auto keeps the rounded corners and
          lets the table scroll horizontally instead. */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all leads on this page"
                  checked={allOnPageSelected}
                  // Some-but-not-all selected shows the dash state rather than
                  // an unticked box, so "select all" stays honest.
                  ref={(el) => {
                    if (el) el.indeterminate = selectedIds.size > 0 && !allOnPageSelected;
                  }}
                  onChange={toggleAllOnPage}
                  disabled={leads.length === 0}
                  className="rounded border-slate-300 cursor-pointer disabled:cursor-not-allowed"
                />
              </th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Owner</th>
              <th className="px-4 py-3">Disposition</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  Loading leads…
                </td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  No leads yet. Connect a Facebook page under Connect Facebook to start receiving leads.
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={`border-b border-slate-100 hover:bg-slate-50 ${selectedIds.has(lead.id) ? "bg-blue-50/50" : ""}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${lead.name || "lead"}`}
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleOne(lead.id)}
                    className="rounded border-slate-300 cursor-pointer"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/leads/${lead.id}`} className="font-medium text-blue-700 hover:underline">
                    {lead.name || "—"}
                  </Link>
                  {lead.isDuplicate && (
                    <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                      POSSIBLE DUPLICATE
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{lead.phone || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{lead.email || "—"}</td>
                <td className="px-4 py-3 text-slate-700">{lead.ownerName || <span className="text-slate-400">Unassigned</span>}</td>
                <td className="px-4 py-3">
                  <select
                    value={lead.disposition}
                    // Without this every row's control announces only as
                    // "combobox" — with 50 rows on screen a screen-reader user
                    // has no way to tell which lead they are about to change.
                    aria-label={`Disposition for ${lead.name || "unnamed lead"}`}
                    onChange={(e) => updateDisposition(lead.id, e.target.value)}
                    style={{ backgroundColor: `${colorFor(lead.disposition)}1a`, color: colorFor(lead.disposition) }}
                    className="text-xs font-medium rounded-full px-3 py-1 border-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {dispositions.map((d) => (
                      <option key={d.id} value={d.label}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-slate-400">{new Date(lead.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginator. Every control drives `page`/`pageSize`, which are sent to
          the API as query params — the browser only ever holds one page of
          rows, never the full 6k+ table. */}
      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <label htmlFor="pageSize" className="text-slate-600">
              Leads per page
            </label>
            <select
              id="pageSize"
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
            >
              {[50, 75, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="hidden sm:inline">
              Showing {((page - 1) * pageSize + 1).toLocaleString()}–
              {Math.min(page * pageSize, total).toLocaleString()} of {total.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              Previous
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                aria-current={n === page ? "page" : undefined}
                className={`text-sm font-medium rounded-md px-3 py-1.5 border ${
                  n === page
                    ? "bg-blue-600 text-white border-blue-600"
                    : "text-slate-700 bg-white border-slate-200 hover:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
