"use client";

import { useCallback, useEffect, useState } from "react";

// Security dashboard (Platform Owner) — the visible face of the
// authentication hardening layer: 24h abuse statistics from security_events,
// plus the LIVE in-memory state (temporarily blocked IPs, locked accounts).

type Snapshot = {
  tableMissing: boolean;
  window: string;
  stats: {
    failedLogins: number;
    otpSent: number;
    otpFailed: number;
    rateLimited: number;
    botDetections: number;
    accountLocks: number;
    ipBlocks: number;
    emailSendFailures: number;
  };
  topIps: { ip: string; events: number }[];
  topEmails: { email: string; events: number }[];
  recent: { event: string; riskLevel: string; email: string | null; ip: string | null; reason: string | null; createdAt: string }[];
  liveBlockedIps: { ip: string; untilIso: string; offenses: number }[];
  liveLockedAccounts: { account: string; failures: number; lockedUntil: string }[];
};

function riskChip(level: string) {
  if (level === "high") return "text-red-700 bg-red-50 border-red-200";
  if (level === "medium") return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

export default function SecurityDashboardPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/super-admin/security");
      if (!res.ok) {
        setError(`Could not load security data (HTTP ${res.status})`);
        return;
      }
      setData(await res.json());
      setError("");
      setRefreshedAt(new Date().toLocaleTimeString());
    } catch {
      setError("Could not load security data");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const stats: { label: string; key: keyof Snapshot["stats"]; alert?: boolean }[] = [
    { label: "Failed logins", key: "failedLogins" },
    { label: "OTP emails sent", key: "otpSent" },
    { label: "OTP failures", key: "otpFailed" },
    { label: "Rate-limited requests", key: "rateLimited" },
    { label: "Bot detections", key: "botDetections", alert: true },
    { label: "Account lockouts", key: "accountLocks", alert: true },
    { label: "IP blocks", key: "ipBlocks", alert: true },
    { label: "OTP email send failures", key: "emailSendFailures", alert: true },
  ];

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 mb-1">Security</h1>
          <p className="text-sm text-slate-500">
            Authentication &amp; abuse protection — last 24 hours, plus live blocks. Auto-refreshes every minute.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {refreshedAt && <span className="text-xs text-slate-400">Updated {refreshedAt}</span>}
          <button
            onClick={load}
            className="text-xs font-medium rounded-md border border-slate-200 px-3 py-1.5 text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}
      {data?.tableMissing && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          The security_events table hasn&apos;t been created yet (migration 0043 pending) — run migrations from
          Diagnostics. Live blocks below still work; historical statistics appear once the migration lands.
        </div>
      )}

      {!data && !error && <div className="text-sm text-slate-400">Loading…</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {stats.map((s) => {
              const value = data.stats[s.key];
              return (
                <div key={s.key} className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className={`text-2xl font-semibold ${s.alert && value > 0 ? "text-red-600" : "text-slate-900"}`}>{value}</div>
                  <div className="text-xs text-slate-500 mt-1">{s.label}</div>
                </div>
              );
            })}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-900 mb-2">Blocked IPs (live)</div>
              {data.liveBlockedIps.length === 0 ? (
                <div className="text-sm text-slate-400">None right now.</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.liveBlockedIps.map((b) => (
                    <li key={b.ip} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-slate-700">{b.ip}</span>
                      <span className="text-xs text-slate-400">
                        until {new Date(b.untilIso).toLocaleTimeString()} · offense #{b.offenses}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-900 mb-2">Locked accounts (live)</div>
              {data.liveLockedAccounts.length === 0 ? (
                <div className="text-sm text-slate-400">None right now.</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.liveLockedAccounts.map((l) => (
                    <li key={l.account} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate">{l.account}</span>
                      <span className="text-xs text-slate-400">
                        {l.failures} failures · until {new Date(l.lockedUntil).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-900 mb-2">Top attacking IPs (24h)</div>
              {data.topIps.length === 0 ? (
                <div className="text-sm text-slate-400">Nothing malicious recorded.</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.topIps.map((r) => (
                    <li key={r.ip} className="flex items-center justify-between text-sm">
                      <span className="font-mono text-slate-700">{r.ip}</span>
                      <span className="text-xs text-slate-500">{r.events} events</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-sm font-medium text-slate-900 mb-2">Most targeted accounts (24h)</div>
              {data.topEmails.length === 0 ? (
                <div className="text-sm text-slate-400">Nothing recorded.</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.topEmails.map((r) => (
                    <li key={r.email} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700 truncate">{r.email}</span>
                      <span className="text-xs text-slate-500">{r.events} events</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-sm font-medium text-slate-900 mb-3">Recent security events</div>
            {data.recent.length === 0 ? (
              <div className="text-sm text-slate-400">No events yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">
                      <th className="py-2 pr-4">Time</th>
                      <th className="py-2 pr-4">Event</th>
                      <th className="py-2 pr-4">Risk</th>
                      <th className="py-2 pr-4">Email</th>
                      <th className="py-2 pr-4">IP</th>
                      <th className="py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((e, i) => (
                      <tr key={`${e.createdAt}-${i}`} className="border-b border-slate-50 last:border-0 align-top">
                        <td className="py-2 pr-4 text-xs text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-700 whitespace-nowrap">{e.event}</td>
                        <td className="py-2 pr-4">
                          <span className={`inline-block text-[11px] font-medium border rounded-full px-2 py-0.5 ${riskChip(e.riskLevel)}`}>
                            {e.riskLevel}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-xs text-slate-600 break-all max-w-[180px]">{e.email || "—"}</td>
                        <td className="py-2 pr-4 font-mono text-xs text-slate-600 whitespace-nowrap">{e.ip || "—"}</td>
                        <td className="py-2 text-xs text-slate-500">{e.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
