"use client";

// Phase 12 — app-level error boundary. Catches any render/runtime error in a
// route segment and shows a friendly message instead of a stack trace. The
// actual error is logged to the browser console (dev) / server telemetry
// (Next.js) — never rendered to the user.
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // digest correlates with the server-side log line; never show `error.message`.
    console.error("UI error boundary:", error.digest || error.message);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="text-center max-w-sm">
        <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="text-sm text-slate-500 mt-1">An unexpected error occurred. Your data is safe. Please try again.</p>
        {error.digest && <p className="text-[11px] text-slate-400 mt-2">Reference: {error.digest}</p>}
        <button onClick={reset} className="mt-4 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">Try again</button>
      </div>
    </div>
  );
}
