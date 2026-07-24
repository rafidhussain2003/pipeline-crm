"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { subscribeLeadStream } from "@/lib/leads/stream-client";

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

type Disposition = { id: string; label: string; color: string; category?: string };

type Assignee = {
  id: string;
  name: string;
  role: string;
  online: boolean;
  presenceStatus: string;
  openLeadCount: number;
};

// Display order of disposition groups — mirrors DISPOSITION_CATEGORIES in
// src/lib/dispositions/taxonomy.ts (not imported: that module sits next to
// server-only code and this file ships to the browser).
const CATEGORY_ORDER = ["NEW", "CONTACT ATTEMPT", "INTERESTED", "SALES", "LOST", "OTHER"];

// The Assign picker. Fetches the company roster (online first) when opened;
// selecting an agent hands the actual POST back to the parent so this stays
// a pure picker. Works identically for 1 selected lead and for many.
function AssignModal({
  count,
  onClose,
  onAssign,
}: {
  count: number;
  onClose: () => void;
  onAssign: (agentId: string) => Promise<string | null>;
}) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Which row is mid-assignment — locks the list so a double-click or a
  // second pick can't fire two overlapping bulk assignments.
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads/assignees")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load the team list");
        setAssignees((await r.json()).assignees || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the team list"))
      .finally(() => setLoading(false));
  }, []);

  async function pick(agentId: string) {
    if (assigningId) return;
    setAssigningId(agentId);
    setError("");
    const failure = await onAssign(agentId);
    if (failure) {
      // On success the parent closes this modal; only a failure comes back.
      setError(failure);
      setAssigningId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={() => !assigningId && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Assign ${count} ${count === 1 ? "lead" : "leads"}`}
        className="w-full max-w-md bg-white rounded-lg shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-900">
            Assign {count === 1 ? "1 Lead" : `${count.toLocaleString()} Leads`}
          </h2>
          <button
            onClick={onClose}
            disabled={!!assigningId}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40 text-lg leading-none px-1"
          >
            ×
          </button>
        </div>

        {error && (
          <div role="alert" className="mx-5 mt-4 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <div className="px-4 py-8 text-center text-sm text-slate-400">Loading team…</div>}
          {!loading && assignees.length === 0 && !error && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">No active team members to assign to.</div>
          )}
          {assignees.map((a) => (
            <button
              key={a.id}
              onClick={() => pick(a.id)}
              disabled={!!assigningId}
              className="w-full flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50"
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${a.online ? "bg-emerald-500" : "bg-slate-300"}`}
                  title={a.online ? "Online" : "Offline"}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900 truncate">
                    {assigningId === a.id ? "Assigning…" : a.name}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {a.online ? "Online" : "Offline"} · {a.openLeadCount.toLocaleString()} open{" "}
                    {a.openLeadCount === 1 ? "lead" : "leads"}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
                {a.role}
              </span>
            </button>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 text-right">
          <button
            onClick={onClose}
            disabled={!!assigningId}
            className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Enterprise Lead Filters — one object drives the query, the URL and the
// active-filter chips. Every field is optional/empty by default; an empty
// value means "this filter is off". Server-side only: these become query
// params on /api/leads, which ANDs them onto the tenant/ownership scope.
type Filters = {
  search: string;
  disposition: string; // label
  ownerId: string; // agent id
  source: string; // source id
  state: string;
  saleStatus: string; // "" | "won" | "lost" | "in_progress"
  followUpToday: boolean;
  date: string; // yyyy-mm-dd
};

const EMPTY_FILTERS: Filters = {
  search: "",
  disposition: "",
  ownerId: "",
  source: "",
  state: "",
  saleStatus: "",
  followUpToday: false,
  date: "",
};

const SALE_STATUS_OPTIONS = [
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "in_progress", label: "In Progress" },
];

// The SINGLE serializer used for BOTH the API request and the browser URL, so
// a shared/refreshed URL reproduces the exact same query. Empty filters and
// page 1 are omitted to keep the URL clean.
function filtersToParams(f: Filters, page: number): URLSearchParams {
  const p = new URLSearchParams();
  if (f.search) p.set("search", f.search);
  if (f.disposition) p.set("disposition", f.disposition);
  if (f.ownerId) p.set("ownerId", f.ownerId);
  if (f.source) p.set("source", f.source);
  if (f.state) p.set("state", f.state);
  if (f.saleStatus) p.set("saleStatus", f.saleStatus);
  if (f.followUpToday) p.set("followUpToday", "1");
  if (f.date) p.set("date", f.date);
  if (page > 1) p.set("page", String(page));
  return p;
}

function paramsToFilters(sp: URLSearchParams): Filters {
  return {
    search: sp.get("search") || "",
    disposition: sp.get("disposition") || "",
    ownerId: sp.get("ownerId") || "",
    source: sp.get("source") || "",
    state: sp.get("state") || "",
    saleStatus: sp.get("saleStatus") || "",
    followUpToday: sp.get("followUpToday") === "1",
    date: sp.get("date") || "",
  };
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  // All active filters in one object; `search` lives here too so the URL and
  // chips treat it like any other filter.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Dropdown data that isn't already loaded elsewhere: Sources + States come
  // from /api/leads/filter-options; Agents (admin/manager only) reuse the
  // assignees roster; Dispositions reuse the existing fetch below.
  const [sources, setSources] = useState<{ id: string; name: string | null }[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [agentOptions, setAgentOptions] = useState<{ id: string; name: string }[]>([]);
  // Set once the URL has been read on mount — the first fetch waits for it so
  // a shared/refreshed URL loads its filters instead of the empty default.
  const [hydrated, setHydrated] = useState(false);
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

  // --- Role-dependent UI --------------------------------------------------
  // Display gating only; every action is re-checked server-side. canAssign
  // mirrors ROLE_PERMISSIONS in src/lib/permissions.ts (leads:assign is
  // admin + manager); agents additionally lose Import/Export (the export API
  // refuses them and import is admin-only).
  const [role, setRole] = useState<string>("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignResult, setAssignResult] = useState("");
  const canAssign = role === "admin" || role === "manager";
  const isAgent = role === "agent";

  useEffect(() => {
    fetch("/api/me")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json();
        setRole(data.user?.role || "");
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async (opts?: { preserveSelection?: boolean; silent?: boolean }) => {
    // `silent` skips the loading state: a realtime refresh must not blank the
    // table out from under someone mid-read (Task 5 — no flickering).
    if (!opts?.silent) setLoading(true);
    setLoadError("");
    // Same serializer as the URL — the query the server runs is exactly the
    // one the address bar describes.
    const params = filtersToParams(filters, page);
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
  }, [filters, page, pageSize]);

  // Change a filter → reset to page 1 (a narrowed result shouldn't strand you
  // on a page that no longer exists) and let the URL/query effects follow.
  const setFilter = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);
  const clearAllFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  }, []);

  // Hydrate filters + page from the URL ONCE on mount (client-only, so no SSR
  // mismatch). Until this runs the first fetch is held back, so a shared or
  // refreshed URL loads its own filtered view instead of the empty default.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setFilters(paramsToFilters(sp));
    const p = parseInt(sp.get("page") || "1", 10);
    if (p > 1) setPage(p);
    setHydrated(true);
  }, []);

  // Reflect filters + page back into the URL (replace, not push — filtering
  // shouldn't spawn a back-button trail). Refresh or copy-link reproduces the
  // exact view.
  useEffect(() => {
    if (!hydrated) return;
    const qs = filtersToParams(filters, page).toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [hydrated, filters, page]);

  useEffect(() => {
    if (!hydrated) return; // wait for URL hydration before the first fetch
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load, hydrated]);

  // A narrowed filter can leave you on a page that no longer exists (page 40 of
  // a 3-page result), which would render an empty table with no way back.
  useEffect(() => {
    if (!loading && page > totalPages) setPage(totalPages);
  }, [loading, page, totalPages]);

  // Source + State options for the filter bar (scoped server-side to the
  // caller's visible leads). Best-effort — empty dropdowns never block search.
  useEffect(() => {
    fetch("/api/leads/filter-options")
      .then((r) => (r.ok ? r.json() : { sources: [], states: [] }))
      .then((d) => {
        setSources(d.sources || []);
        setStates(d.states || []);
      })
      .catch(() => {});
  }, []);

  // Agent filter options — admin/manager only (the assignees roster is gated
  // by leads:assign). Agents never see this filter: they are already
  // hard-scoped to their own leads server-side, so there's nothing to pick.
  useEffect(() => {
    if (role !== "admin" && role !== "manager") return;
    fetch("/api/leads/assignees")
      .then((r) => (r.ok ? r.json() : { assignees: [] }))
      .then((d: { assignees?: { id: string; name: string }[] }) =>
        setAgentOptions((d.assignees || []).map((a) => ({ id: a.id, name: a.name })))
      )
      .catch(() => {});
  }, [role]);

  // --- Phase 1B: realtime arrivals ---------------------------------------
  // Arrivals are COUNTED, never auto-inserted: the table only changes when the
  // user clicks View (Task 3). Nothing here touches page, search, pageSize,
  // sorting, selection or scroll (Task 2).
  const [pendingCount, setPendingCount] = useState(0);
  const [connected, setConnected] = useState(false);
  // Ids rather than a bare counter so two tabs, a reconnect replay and a live
  // push can't count the same lead twice (Task 4 — no duplicate notifications).
  const pendingIdsRef = useRef<Set<string>>(new Set());
  // load() changes identity on every keystroke; the stream subscription must
  // not churn when it does, so the handlers read it through a ref.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  // Coalesces the per-lead "lead.assigned" frames of a bulk assignment into
  // one silent refetch.
  const assignedReloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime, via the tab's SHARED stream connection (stream-client.ts owns
  // the reconnect/backoff/`since`-watermark plumbing that used to live here).
  useEffect(() => {
    const unsubscribe = subscribeLeadStream({
      onConnectionChange: setConnected,
      events: {
        "lead.created": (raw) => {
          try {
            const data = JSON.parse(raw) as { leadId: string; at: string };
            if (pendingIdsRef.current.has(data.leadId)) return; // already counted
            pendingIdsRef.current.add(data.leadId);
            setPendingCount(pendingIdsRef.current.size);
          } catch {
            /* a malformed frame must not kill the handler */
          }
        },
        // Ownership changed somewhere (this tab, a colleague, the automatic
        // engine). Re-run the CURRENT query — silently, keeping selection and
        // scroll — so the Owner column is live for every connected user.
        // Debounced: a bulk assignment emits one frame per lead, and 50
        // frames should cost one refetch, not 50.
        "lead.assigned": () => {
          if (assignedReloadRef.current) clearTimeout(assignedReloadRef.current);
          assignedReloadRef.current = setTimeout(() => {
            loadRef.current({ preserveSelection: true, silent: true });
          }, 400);
        },
        // Arrivals that happened while this tab was disconnected. Counted,
        // not listed — the exact rows come from the normal query on View.
        missed: (raw) => {
          try {
            const data = JSON.parse(raw) as { count: number };
            if (data.count > 0) setPendingCount((n) => n + data.count);
          } catch {
            /* ignore */
          }
        },
      },
    });
    return () => {
      if (assignedReloadRef.current) clearTimeout(assignedReloadRef.current);
      unsubscribe();
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
      .then(async (r) => {
        if (!r.ok) return;
        setDispositions((await r.json()).dispositions || []);
      })
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not save (HTTP ${res.status})`);
      }
      setLoadError("");
    } catch (err) {
      if (previous !== undefined) setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, disposition: previous } : l)));
      setLoadError(err instanceof Error ? err.message : "Could not update that lead");
      // A silent revert looks exactly like a dead dropdown — make sure the
      // error banner is actually on screen.
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function colorFor(label: string) {
    return dispositions.find((d) => d.label === label)?.color || "#64748b";
  }

  // Options grouped for the <optgroup> select: taxonomy categories in fixed
  // order, any admin-invented category after them, options keeping the API's
  // sortOrder within each group.
  const groupedDispositions = (() => {
    const groups = new Map<string, Disposition[]>();
    for (const d of dispositions) {
      const cat = d.category || "OTHER";
      const list = groups.get(cat);
      if (list) list.push(d);
      else groups.set(cat, [d]);
    }
    const ordered = [
      ...CATEGORY_ORDER.filter((c) => groups.has(c)),
      ...[...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    return ordered.map((category) => ({ category, options: groups.get(category)! }));
  })();

  // Assign the current selection to one agent. Returns an error message for
  // the modal to display, or null on success (parent closes the modal). The
  // same call serves ONE selected lead and a whole page of them.
  async function assignSelected(agentId: string): Promise<string | null> {
    const ids = [...selectedIds];
    if (ids.length === 0) return "No leads are selected.";
    try {
      const res = await fetch("/api/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: ids, agentId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error || "Could not assign the selected leads.";
      setAssignOpen(false);
      setSelectedIds(new Set());
      setAssignResult(
        `Assigned ${data.assignedCount === 1 ? "1 lead" : `${Number(data.assignedCount).toLocaleString()} leads`}.` +
          (data.skippedCount > 0 ? ` ${data.skippedCount} could not be found and ${data.skippedCount === 1 ? "was" : "were"} skipped.` : "")
      );
      // The owner column must update immediately for the user who assigned —
      // a silent refetch of the current page, no flicker, no scroll jump.
      await load({ silent: true });
      return null;
    } catch {
      return "Could not assign the selected leads.";
    }
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

  // Shared control styling for the filter bar.
  const selectCls =
    "rounded-md border border-slate-200 px-2.5 py-2 text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500";

  // Active-filter chips — one per set filter, each individually removable,
  // with human-readable labels resolved from the option lists.
  const agentName = (id: string) => agentOptions.find((a) => a.id === id)?.name || "Agent";
  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name || "Source";
  const saleLabel = (v: string) => SALE_STATUS_OPTIONS.find((o) => o.value === v)?.label || v;
  const activeChips: { key: string; label: string; clear: () => void }[] = [
    filters.search && { key: "search", label: `Search: ${filters.search}`, clear: () => setFilter({ search: "" }) },
    filters.disposition && { key: "disposition", label: `Disposition: ${filters.disposition}`, clear: () => setFilter({ disposition: "" }) },
    filters.ownerId && { key: "ownerId", label: `Agent: ${agentName(filters.ownerId)}`, clear: () => setFilter({ ownerId: "" }) },
    filters.source && { key: "source", label: `Source: ${sourceName(filters.source)}`, clear: () => setFilter({ source: "" }) },
    filters.state && { key: "state", label: `State: ${filters.state}`, clear: () => setFilter({ state: "" }) },
    filters.saleStatus && { key: "saleStatus", label: `Sale: ${saleLabel(filters.saleStatus)}`, clear: () => setFilter({ saleStatus: "" }) },
    filters.followUpToday && { key: "followUpToday", label: "Follow-up Today", clear: () => setFilter({ followUpToday: false }) },
    filters.date && { key: "date", label: `Created: ${filters.date}`, clear: () => setFilter({ date: "" }) },
  ].filter((c): c is { key: string; label: string; clear: () => void } => Boolean(c));

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
        {/* Import/Export are management tools — hidden from agents, and the
            APIs behind them refuse agents regardless. */}
        {!isAgent && (
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
        )}
      </div>

      {importResult && (
        <div className="mb-4 text-sm bg-blue-50 border border-blue-100 text-blue-800 rounded-md px-3 py-2">{importResult}</div>
      )}

      {assignResult && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-3 text-sm bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-md px-3 py-2"
        >
          <span>{assignResult}</span>
          <button onClick={() => setAssignResult("")} aria-label="Dismiss" className="shrink-0 text-emerald-700 hover:text-emerald-900">
            ×
          </button>
        </div>
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

      {/* Enterprise Lead Filter bar. Every control filters SERVER-SIDE (the
          browser never holds more than one page) and updates the URL; changing
          any one re-runs the query with no page reload, ALL filters combined
          with AND. Filters compose with search, pagination, sorting and the
          realtime/bulk-assign features untouched. */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="Search name, phone, email"
            className="flex-1 min-w-[200px] max-w-md rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select value={filters.disposition} onChange={(e) => setFilter({ disposition: e.target.value })} aria-label="Filter by disposition" className={selectCls}>
            <option value="">All Dispositions</option>
            {groupedDispositions.map((g) => (
              <optgroup key={g.category} label={g.category}>
                {g.options.map((d) => (
                  <option key={d.id} value={d.label}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {/* Agent filter — admin/manager only. Agents are already scoped to
              their own leads server-side, so the API ignores ?ownerId= for
              them and this control is hidden. */}
          {canAssign && (
            <select value={filters.ownerId} onChange={(e) => setFilter({ ownerId: e.target.value })} aria-label="Filter by agent" className={selectCls}>
              <option value="">All Agents</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <select value={filters.source} onChange={(e) => setFilter({ source: e.target.value })} aria-label="Filter by source" className={selectCls}>
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || "Unnamed source"}
              </option>
            ))}
          </select>
          <select value={filters.state} onChange={(e) => setFilter({ state: e.target.value })} aria-label="Filter by state" className={selectCls}>
            <option value="">All States</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={filters.saleStatus} onChange={(e) => setFilter({ saleStatus: e.target.value })} aria-label="Filter by sale status" className={selectCls}>
            <option value="">All Sale Status</option>
            {SALE_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setFilter({ followUpToday: !filters.followUpToday })}
            aria-pressed={filters.followUpToday}
            className={`text-sm font-medium rounded-md px-3 py-2 border ${
              filters.followUpToday
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
            }`}
          >
            Follow-up Today
          </button>
          <input
            type="date"
            value={filters.date}
            onChange={(e) => setFilter({ date: e.target.value })}
            aria-label="Filter by created date"
            className={selectCls}
          />
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeChips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-800 bg-blue-50 border border-blue-200 rounded-full pl-2.5 pr-1.5 py-1"
              >
                {c.label}
                <button onClick={c.clear} aria-label={`Remove ${c.label} filter`} className="text-blue-500 hover:text-blue-800 text-sm leading-none">
                  ×
                </button>
              </span>
            ))}
            <button onClick={clearAllFilters} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline">
              Clear all filters
            </button>
          </div>
        )}
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

      {/* Bulk-action bar. Rendered ONLY when at least one lead is ticked (zero
          selected = no bulk actions on screen at all) and only for users who
          can actually assign — the API enforces the same permission again. */}
      {selectedIds.size > 0 && canAssign && (
        <div className="flex items-center justify-between gap-3 mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-sm font-medium text-blue-900">
            {selectedIds.size === 1 ? "1 Lead Selected" : `${selectedIds.size.toLocaleString()} Leads Selected`}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm font-medium text-slate-600 hover:text-slate-800 px-2 py-1.5"
            >
              Clear
            </button>
            <button
              onClick={() => setAssignOpen(true)}
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-4 py-1.5"
            >
              Assign
            </button>
          </div>
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
                    {groupedDispositions.map((g) => (
                      <optgroup key={g.category} label={g.category}>
                        {g.options.map((d) => (
                          <option key={d.id} value={d.label}>
                            {d.label}
                          </option>
                        ))}
                      </optgroup>
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

      {assignOpen && (
        <AssignModal count={selectedIds.size} onClose={() => setAssignOpen(false)} onAssign={assignSelected} />
      )}
    </div>
  );
}
