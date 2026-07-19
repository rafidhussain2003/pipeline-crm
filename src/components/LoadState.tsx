"use client";

import { useCallback, useEffect, useState } from "react";

// Shared load/error/retry handling for the module dashboards.
//
// Those pages all did the same thing:
//
//   const [d, setD] = useState(null);
//   useEffect(() => { fetch(url).then(async (r) => { if (r.ok) setD(...) }) }, []);
//   if (!d) return <div>Loading…</div>;
//
// which has no failure branch at all. A rejected fetch (network down) or any
// non-OK response (500, 403, an expired subscription's 402) leaves the state
// null forever, so the page sits on "Loading…" permanently — no message, no
// retry, and refreshing just repeats it. This hook gives those pages the
// missing third state, and gives every one of them the SAME third state.

export type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
};

export function useLoadedData<T>(url: string, pick: (body: unknown) => T): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // Prefer the API's own message (they are written for users — "Your
        // subscription is inactive", "Feature Not Enabled") and fall back to
        // something honest rather than a bare status code.
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Could not load this page (${res.status})`);
      }
      setData(pick(await res.json()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this page");
      setData(null);
    } finally {
      // In `finally`, so the spinner clears on the failure path too — that
      // omission is what made the original hang.
      setLoading(false);
    }
    // `pick` is defined inline at every call site, so a new identity each
    // render; depending on it would re-fetch forever. The URL is the input
    // that actually decides what to load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, reload: load };
}

export function LoadingPane({ label = "Loading…" }: { label?: string }) {
  return <div className="p-6 text-sm text-slate-400">{label}</div>;
}

// The failure state the dashboards were missing: says what went wrong and
// offers the one action that can fix it, instead of an endless spinner.
export function LoadErrorPane({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-6">
      <div role="alert" className="max-w-lg bg-red-50 border border-red-100 text-red-800 rounded-md px-4 py-3">
        <p className="text-sm font-medium">Couldn&apos;t load this page</p>
        <p className="text-sm mt-1 text-red-700">{message}</p>
        <button
          onClick={onRetry}
          className="mt-3 text-xs font-semibold text-red-800 bg-red-100 hover:bg-red-200 rounded px-3 py-1.5"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
