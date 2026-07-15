"use client";

// Phase 12 — root global error boundary (catches errors in the root layout
// itself, where the normal error.tsx can't render). Must include <html>/<body>.
// Friendly message only; never a stack trace.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#0f172a" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>An unexpected error occurred. Please refresh and try again.</p>
          {error.digest && <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8 }}>Reference: {error.digest}</p>}
          <button onClick={reset} style={{ marginTop: 16, background: "#0f172a", color: "#fff", fontSize: 14, fontWeight: 500, padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer" }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
