"use client";

// Phase 13 — first-time company setup wizard: Company Profile → Invite Agents →
// Connect Meta → Import Leads → Dashboard. Optional steps link to the existing
// feature pages; "Finish" marks onboarding complete.
import { useEffect, useState } from "react";
import Link from "next/link";

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "UTC"];
function toMin(h: string) { const [H, M] = h.split(":").map(Number); return H * 60 + (M || 0); }
function toHM(min: number | null) { if (min == null) return ""; const h = Math.floor(min / 60), m = min % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/onboarding").then((r) => r.json()).then((d) => {
      if (d.company) {
        setLogoUrl(d.company.logoUrl || "");
        if (d.company.timezone) setTimezone(d.company.timezone);
        if (d.company.businessHoursStart != null) setStart(toHM(d.company.businessHoursStart));
        if (d.company.businessHoursEnd != null) setEnd(toHM(d.company.businessHoursEnd));
      }
    }).catch(() => {});
  }, []);

  async function saveProfile() {
    setBusy(true);
    await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logoUrl, timezone, businessHoursStart: toMin(start), businessHoursEnd: toMin(end) }) });
    setBusy(false); setStep(2);
  }
  async function finish() {
    setBusy(true);
    await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ complete: true }) });
    window.location.href = "/leads";
  }

  const steps = ["Company Profile", "Invite Agents", "Connect Meta", "Import Leads"];

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="text-center mb-6"><h1 className="text-xl font-semibold text-slate-900">Welcome to Ziplod 🎉</h1><p className="text-sm text-slate-500 mt-1">A few quick steps to set up your workspace.</p></div>
      <div className="flex gap-1.5 mb-5">{steps.map((_, i) => <div key={i} className={`h-1 flex-1 rounded-full ${step >= i + 1 ? "bg-slate-900" : "bg-slate-200"}`} />)}</div>
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="text-xs uppercase tracking-wide text-slate-400 mb-1">Step {step} of 4</div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">{steps[step - 1]}</h2>

        {step === 1 && (
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-500 mb-1">Company logo URL (optional)</label><input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…/logo.png" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs font-medium text-slate-500 mb-1">Timezone</label><select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">{TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-slate-500 mb-1">Business hours start</label><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-slate-500 mb-1">End</label><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" /></div>
            </div>
            <button onClick={saveProfile} disabled={busy} className="w-full bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Saving…" : "Save & continue"}</button>
          </div>
        )}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Invite your team now, or do it later from Agents. Each invited agent sets their own password on first login.</p>
            <Link href="/settings/agents" className="block text-center bg-slate-100 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-md">Open Agents →</Link>
            <div className="flex gap-2"><button onClick={() => setStep(1)} className="flex-1 border border-slate-200 text-sm px-4 py-2.5 rounded-md">Back</button><button onClick={() => setStep(3)} className="flex-1 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md">Continue</button></div>
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Connect your Facebook Lead Ads account to start receiving leads automatically.</p>
            <Link href="/settings/connector" className="block text-center bg-slate-100 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-md">Connect Meta →</Link>
            <div className="flex gap-2"><button onClick={() => setStep(2)} className="flex-1 border border-slate-200 text-sm px-4 py-2.5 rounded-md">Back</button><button onClick={() => setStep(4)} className="flex-1 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md">Continue</button></div>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Optionally import your historical leads from a connected source. You can always do this later.</p>
            <Link href="/settings/connector" className="block text-center bg-slate-100 text-slate-800 text-sm font-medium px-4 py-2.5 rounded-md">Import historical leads →</Link>
            <div className="flex gap-2"><button onClick={() => setStep(3)} className="flex-1 border border-slate-200 text-sm px-4 py-2.5 rounded-md">Back</button><button onClick={finish} disabled={busy} className="flex-1 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-md disabled:opacity-50">{busy ? "Finishing…" : "Go to dashboard"}</button></div>
          </div>
        )}
      </div>
      <button onClick={finish} className="w-full text-center text-xs text-slate-400 mt-4">Skip setup for now</button>
    </div>
  );
}
