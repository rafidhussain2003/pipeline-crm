"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Phase 4A — Platform Owner Company Management.
//
// Read + navigate only; every edit happens on the detail page. Server-side
// search/sort/pagination via /api/super-admin/companies, which is
// requireSuperAdmin-gated — this page never sees a tenant it is not entitled to.

type Owner = { name: string; email: string } | null;
type Company = {
  id: string;
  name: string;
  status: string;
  plan: string | null;
  subscriptionStatus: string | null;
  supportEmail: string | null;
  businessPhone: string | null;
  createdAt: string;
  owner: Owner;
};

const SORTS = [
  { id: "createdAt", label: "Created" },
  { id: "name", label: "Name" },
  { id: "status", label: "Status" },
  { id: "plan", label: "Plan" },
  { id: "updatedAt", label: "Updated" },
] as const;

export default function CompanyManagementPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string>("createdAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const p = new URLSearchParams({ sort, dir, page: String(page), pageSize: String(pageSize) });
    if (search) p.set("search", search);
    try {
      const res = await fetch(`/api/super-admin/companies?${p}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not load companies (${res.status})`);
      const data = await res.json();
      setCompanies(data.companies || []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch (e) {
      // Stated plainly and retryable — a failed load must never look like
      // "this platform has no tenants".
      setError(e instanceof Error ? e.message : "Could not load companies");
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, [search, sort, dir, page, pageSize]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // A narrowed search can strand you on a page that no longer exists.
  useEffect(() => {
    if (!loading && page > totalPages) setPage(totalPages);
  }, [loading, page, totalPages]);

  function toggleSort(id: string) {
    if (sort === id) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(id);
      setDir("asc");
    }
    setPage(1);
  }

  const pageNumbers = (() => {
    const MAX = 10;
    if (totalPages <= MAX) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const start = Math.min(Math.max(1, page - Math.floor(MAX / 2)), totalPages - MAX + 1);
    return Array.from({ length: MAX }, (_, i) => start + i);
  })();

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">
          Company Management <span className="text-blue-600">{total.toLocaleString()} total</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">Every tenant on the platform. Select a company to view or edit its details.</p>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{error}</span>
          <button onClick={() => load()} className="shrink-0 text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 rounded px-2.5 py-1">
            Retry
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search name, contact email, phone"
          className="w-full max-w-md rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <label htmlFor="sort">Sort</label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              setDir((d) => (d === "asc" ? "desc" : "asc"));
              setPage(1);
            }}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            aria-label={`Sort ${dir === "asc" ? "ascending" : "descending"}`}
          >
            {dir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
              {[
                ["name", "Company"],
                ["", "Company ID"],
                ["", "Owner"],
                ["", "Contact Email"],
                ["", "Phone"],
                ["plan", "Plan"],
                ["status", "Status"],
                ["createdAt", "Created"],
              ].map(([key, label], i) => (
                <th key={i} className="px-4 py-3">
                  {key ? (
                    <button onClick={() => toggleSort(key)} className="hover:text-slate-700">
                      {label}
                      {sort === key ? (dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  Loading companies…
                </td>
              </tr>
            )}
            {!loading && companies.length === 0 && !error && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                  No companies match that search.
                </td>
              </tr>
            )}
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/super-admin/companies/${c.id}`} className="font-medium text-blue-700 hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-slate-400">{c.id.slice(0, 8)}…</td>
                <td className="px-4 py-3 text-slate-700">
                  {c.owner ? (
                    <>
                      {c.owner.name}
                      <span className="block text-[11px] text-slate-400">{c.owner.email}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{c.supportEmail || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{c.businessPhone || "—"}</td>
                <td className="px-4 py-3 text-slate-700">{c.plan || "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-medium rounded-full px-2 py-0.5 ${
                      c.status === "active" ? "text-emerald-700 bg-emerald-50" : "text-slate-600 bg-slate-100"
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <label htmlFor="pageSize">Per page</label>
            <select
              id="pageSize"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm text-slate-700"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="hidden sm:inline">
              Showing {((page - 1) * pageSize + 1).toLocaleString()}–{Math.min(page * pageSize, total).toLocaleString()} of{" "}
              {total.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
            >
              Previous
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                aria-current={n === page ? "page" : undefined}
                className={`text-sm font-medium rounded-md px-3 py-1.5 border ${
                  n === page ? "bg-blue-600 text-white border-blue-600" : "text-slate-700 bg-white border-slate-200 hover:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-1.5 disabled:opacity-40 hover:bg-slate-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
