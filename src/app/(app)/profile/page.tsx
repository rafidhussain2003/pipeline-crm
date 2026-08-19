"use client";

import { useEffect, useState, useCallback } from "react";
import PinSettings from "@/components/auth/PinSettings";

type Tab = "company" | "account" | "notifications" | "security";

type CompanyForm = {
  name: string;
  logoUrl: string;
  website: string;
  address: string;
  timezone: string;
  supportEmail: string;
  businessPhone: string;
};

type Session = { role: "super_admin" | "admin" | "manager" | "agent" | "lead_distributor"; companyId: string | null };

export default function ProfilePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("account");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setSession(d.user || null));
  }, []);

  if (!session) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const hasCompany = !!session.companyId;
  const isAdmin = session.role === "admin";

  // Lead Distribution Manager gets ONLY their own personal profile — no
  // Company (organization) tab, matching the console's "own profile only" rule.
  const showCompanyTab = hasCompany && session.role !== "lead_distributor";
  const tabs: { id: Tab; label: string }[] = [
    ...(showCompanyTab ? [{ id: "company" as Tab, label: "Company" }] : []),
    { id: "account", label: "Account" },
    { id: "notifications", label: "Notifications" },
    { id: "security", label: "Security" },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Profile</h1>
        <p className="text-sm text-slate-500">Manage your account, company, notifications, and security.</p>
      </div>

      <div className="flex gap-2 mb-6 border-b border-slate-200 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" && showCompanyTab && <CompanyTab canEdit={isAdmin} />}
      {tab === "account" && <AccountTab isAgent={session.role === "agent"} />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "security" && <SecurityTab />}
    </div>
  );
}

function SavedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 ml-2">Saved</span>;
}

// ---------------------------------------------------------------------------
// Company tab
// ---------------------------------------------------------------------------
function CompanyTab({ canEdit }: { canEdit: boolean }) {
  const [form, setForm] = useState<CompanyForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  // Manager Privacy Mode — kept separate from the text CompanyForm (it's a
  // boolean). Admin-controlled; defaults ON.
  const [privacyMode, setPrivacyMode] = useState(true);
  // Agent lead-visibility limit — a string so the field can be blank (= use
  // the default). Admin-controlled.
  const [agentLeadLimit, setAgentLeadLimit] = useState("");
  // Require agents to set a login PIN — admin-controlled boolean.
  const [requirePin, setRequirePin] = useState(false);
  // Secure Notepad — company toggle + last-cleanup stamp (read-only status).
  const [notepadEnabled, setNotepadEnabled] = useState(true);
  const [notepadCleanupAt, setNotepadCleanupAt] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/company-settings")
      .then((r) => r.json())
      .then((d) => {
        setForm({
          name: d.company?.name || "",
          logoUrl: d.company?.logoUrl || "",
          website: d.company?.website || "",
          address: d.company?.address || "",
          timezone: d.company?.timezone || "",
          supportEmail: d.company?.supportEmail || "",
          businessPhone: d.company?.businessPhone || "",
        });
        setPrivacyMode(d.company?.managerPrivacyMode ?? true);
        setAgentLeadLimit(d.company?.agentLeadVisibilityLimit != null ? String(d.company.agentLeadVisibilityLimit) : "");
        setRequirePin(!!d.company?.requireAgentPin);
        setNotepadEnabled(d.company?.notepadEnabled ?? true);
        setNotepadCleanupAt(d.company?.notepadCleanupAt ?? null);
      });
  }, []);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/company-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        managerPrivacyMode: privacyMode,
        // Blank → null (reset to default); otherwise the raw string, which the
        // API parses + range-checks (so a typo surfaces as an error, not a
        // silent reset).
        agentLeadVisibilityLimit: agentLeadLimit.trim() === "" ? null : agentLeadLimit.trim(),
        requireAgentPin: requirePin,
        notepadEnabled,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to save company settings.");
    }
  }

  if (!form) return <div className="text-sm text-slate-400">Loading…</div>;

  const field = (key: keyof CompanyForm, label: string, placeholder?: string) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        value={form[key]}
        disabled={!canEdit}
        placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      {!canEdit && (
        <p className="text-xs text-slate-400 bg-slate-50 rounded-md px-3 py-2">
          Only a company admin can edit these settings. You can view them here.
        </p>
      )}
      {field("name", "Company Name")}
      {field("logoUrl", "Company Logo", "https://…")}
      {field("website", "Website", "https://example.com")}
      {field("address", "Business Address")}
      {field("timezone", "Timezone", "e.g. America/New_York")}
      {field("supportEmail", "Support Email", "support@example.com")}
      {field("businessPhone", "Business Phone")}

      {/* Manager Privacy Mode — governs whether the Lead Distribution Manager
          role sees customer PII. Admin-only (disabled when !canEdit). */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-900">Manager Privacy Mode</div>
            <div className="text-xs text-slate-500 mt-0.5 max-w-md">
              When on, Lead Distribution Managers see leads with customer identity hidden (Fresh/Assigned Lead, last-4
              phone only). Turn off to let them see full customer details like a trusted operational manager.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={privacyMode}
            aria-label="Manager Privacy Mode"
            disabled={!canEdit}
            onClick={() => setPrivacyMode((v) => !v)}
            className={`shrink-0 text-xs font-semibold rounded-full px-4 py-2 border transition-colors disabled:opacity-50 ${
              privacyMode
                ? "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                : "text-slate-600 bg-slate-100 border-slate-300 hover:bg-slate-200"
            }`}
          >
            {privacyMode ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Agent Lead Visibility Limit — how many of their most-recently-assigned
          leads an agent can see. Admin-only (disabled when !canEdit); blank =
          the default. Enforced at the database (see src/lib/leads/access.ts). */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-900">Agent Lead Visibility Limit</div>
            <div className="text-xs text-slate-500 mt-0.5 max-w-md">
              The most recent leads an agent can see in their CRM. Older assigned leads are hidden from the agent (never
              deleted — admins and managers still see the full history). Leave blank for the default (400). Allowed 50–100000.
            </div>
          </div>
          <input
            type="number"
            inputMode="numeric"
            min={50}
            max={100000}
            value={agentLeadLimit}
            disabled={!canEdit}
            placeholder="400"
            aria-label="Agent lead visibility limit"
            onChange={(e) => setAgentLeadLimit(e.target.value)}
            className="shrink-0 w-28 rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Require agents to set a login PIN — admin-only. Admins/managers may
          still opt in individually from Profile > Security. */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-900">Require Agents to Set a Login PIN</div>
            <div className="text-xs text-slate-500 mt-0.5 max-w-md">
              When on, every agent must create a 4-digit PIN — asked after a fresh sign-in or ~1 hour of inactivity.
              Admins and managers can still opt in from Profile → Security.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={requirePin}
            aria-label="Require agents to set a login PIN"
            disabled={!canEdit}
            onClick={() => setRequirePin((v) => !v)}
            className={`shrink-0 text-xs font-semibold rounded-full px-4 py-2 border transition-colors disabled:opacity-50 ${
              requirePin
                ? "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                : "text-slate-600 bg-slate-100 border-slate-300 hover:bg-slate-200"
            }`}
          >
            {requirePin ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {/* Secure Notepad — enable/disable + weekly-cleanup status. */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-900">Secure Notepad</div>
            <div className="text-xs text-slate-500 mt-0.5 max-w-md">
              A private, fast notepad for every team member. SSNs, dates of birth and card numbers are detected and
              protected automatically; protected items are permanently removed every Friday.{" "}
              <span className="text-slate-400">
                {notepadCleanupAt ? `Last cleanup: ${new Date(notepadCleanupAt).toLocaleString()}.` : "Cleanup runs every Friday."}
              </span>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notepadEnabled}
            aria-label="Secure Notepad"
            disabled={!canEdit}
            onClick={() => setNotepadEnabled((v) => !v)}
            className={`shrink-0 text-xs font-semibold rounded-full px-4 py-2 border transition-colors disabled:opacity-50 ${
              notepadEnabled
                ? "text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"
                : "text-slate-600 bg-slate-100 border-slate-300 hover:bg-slate-200"
            }`}
          >
            {notepadEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {canEdit && (
        <div className="flex items-center pt-2">
          <button
            onClick={save}
            disabled={saving}
            className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <SavedBadge show={saved} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account tab
// ---------------------------------------------------------------------------
function AccountTab({ isAgent }: { isAgent: boolean }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [originalEmail, setOriginalEmail] = useState("");
  const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const load = useCallback(() => {
    fetch("/api/account")
      .then((r) => r.json())
      .then((d) => {
        setName(d.user?.name || "");
        setPhone(d.user?.phone || "");
        setEmail(d.user?.email || "");
        setOriginalEmail(d.user?.email || "");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileError("");
    setProfileSaved(false);
    const body: Record<string, string> = { name, phone };
    // Only send email + password if the email field actually changed —
    // avoids asking for a password confirmation on a plain name edit.
    // (Agents can't reach this branch — their email field is read-only.)
    if (!isAgent && email !== originalEmail) {
      if (!currentPasswordForEmail) {
        setProfileSaving(false);
        setProfileError("Enter your current password to change your login email.");
        return;
      }
      body.email = email;
      body.currentPassword = currentPasswordForEmail;
    }
    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setProfileSaving(false);
    if (res.ok) {
      setProfileSaved(true);
      setOriginalEmail(email);
      setCurrentPasswordForEmail("");
      setTimeout(() => setProfileSaved(false), 2500);
    } else {
      const data = await res.json().catch(() => ({}));
      setProfileError(typeof data.error === "string" ? data.error : "Failed to save.");
    }
  }

  async function changePassword() {
    setPasswordError("");
    setPasswordMessage("");
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirm password do not match.");
      return;
    }
    setPasswordSaving(true);
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setPasswordSaving(false);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPasswordMessage("Password changed. You'll stay signed in here, but other devices have been signed out.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } else {
      setPasswordError(typeof data.error === "string" ? data.error : "Failed to change password.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">{isAgent ? "My Details" : "Owner Details"}</h2>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{isAgent ? "Name" : "Owner Name"}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone Number</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 000 0000"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Login Email</label>
          <input
            value={email}
            disabled={isAgent}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isAgent && (
            <p className="text-xs text-slate-400 mt-1">
              Changing your email requires administrator approval — use the request below.
            </p>
          )}
        </div>
        {!isAgent && email !== originalEmail && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Current Password (required to change email)</label>
            <input
              type="password"
              value={currentPasswordForEmail}
              onChange={(e) => setCurrentPasswordForEmail(e.target.value)}
              placeholder="Confirm your password to change your login email"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}
        {profileError && <p className="text-sm text-red-600">{profileError}</p>}
        <div className="flex items-center pt-1">
          <button
            onClick={saveProfile}
            disabled={profileSaving}
            className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
          >
            {profileSaving ? "Saving…" : "Save Changes"}
          </button>
          <SavedBadge show={profileSaved} />
        </div>
      </div>

      {isAgent && <AgentChangeRequests />}

      {!isAgent && (
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Change Password</h2>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
        {passwordMessage && <p className="text-sm text-emerald-700">{passwordMessage}</p>}
        <button
          onClick={changePassword}
          disabled={passwordSaving}
          className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
        >
          {passwordSaving ? "Updating…" : "Change Password"}
        </button>
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent change requests (administrator approval workflow)
// ---------------------------------------------------------------------------
// Agents can't change their login email or password directly. They submit a
// request here; a verification code goes ONLY to the company administrator,
// who relays it if they approve; the agent then completes the change with
// that code. Both steps are backed by /api/account/change-request.
function AgentChangeRequests() {
  return (
    <>
      <ChangeRequestCard
        type="email"
        title="Request Email Change"
        description="Enter your new email and your current password. Your administrator receives an approval code — enter it here once they share it with you."
      />
      <ChangeRequestCard
        type="password"
        title="Request Password Change"
        description="Confirm your current password to request a change. Once your administrator shares the approval code, choose your new password here."
      />
    </>
  );
}

function ChangeRequestCard({ type, title, description }: { type: "email" | "password"; title: string; description: string }) {
  const [step, setStep] = useState<"request" | "complete">("request");
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submitRequest() {
    setError("");
    setMessage("");
    if (type === "email" && !newEmail.trim()) {
      setError("Enter the new email address you want.");
      return;
    }
    if (!currentPassword) {
      setError("Your current password is required.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/account/change-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, currentPassword, ...(type === "email" ? { newEmail } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not submit the request.");
      return;
    }
    setStep("complete");
    setMessage(data.message || "Your administrator has been emailed an approval code.");
  }

  async function submitComplete() {
    setError("");
    if (!code.trim()) {
      setError("Enter the approval code from your administrator.");
      return;
    }
    if (type === "password") {
      if (newPassword.length < 8) {
        setError("New password must be at least 8 characters.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("New password and confirm password do not match.");
        return;
      }
    }
    setBusy(true);
    const res = await fetch("/api/account/change-request/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, code, ...(type === "password" ? { newPassword } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not complete the change.");
      return;
    }
    setMessage(data.message || "Change completed.");
    setStep("request");
    setNewEmail("");
    setCurrentPassword("");
    setCode("");
    setNewPassword("");
    setConfirmPassword("");
    if (type === "email") window.location.reload();
  }

  const inputCls = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <p className="text-xs text-slate-500">{description}</p>

      {step === "request" && (
        <>
          {type === "email" && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Email</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={inputCls} />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={inputCls} />
          </div>
        </>
      )}

      {step === "complete" && (
        <>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Approval Code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              placeholder="6-digit code from your administrator"
              className={`${inputCls} tracking-widest`}
            />
          </div>
          {type === "password" && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} />
              </div>
            </>
          )}
        </>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-emerald-700">{message}</p>}

      <div className="flex items-center gap-3">
        <button
          onClick={step === "request" ? submitRequest : submitComplete}
          disabled={busy}
          className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-50"
        >
          {busy ? "Working…" : step === "request" ? "Submit Request" : "Complete Change"}
        </button>
        {step === "complete" && (
          <button
            onClick={() => {
              setStep("request");
              setError("");
              setMessage("");
            }}
            disabled={busy}
            className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications tab
// ---------------------------------------------------------------------------
function NotificationsTab() {
  const [prefs, setPrefs] = useState<{ emailNotificationsEnabled: boolean; smsNotificationsEnabled: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/account/notifications")
      .then((r) => r.json())
      .then((d) => setPrefs(d.preferences || null));
  }, []);

  async function toggle(key: "emailNotificationsEnabled" | "smsNotificationsEnabled") {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await fetch("/api/account/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next[key] }),
    });
  }

  if (!prefs) return <div className="text-sm text-slate-400">Loading…</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-slate-900">Email Notifications</div>
          <div className="text-xs text-slate-400 mt-0.5">Receive notifications by email.</div>
        </div>
        <button
          onClick={() => toggle("emailNotificationsEnabled")}
          className={`text-xs font-medium rounded-full px-3 py-1.5 ${
            prefs.emailNotificationsEnabled ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
          }`}
        >
          {prefs.emailNotificationsEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        <div>
          <div className="text-sm font-medium text-slate-900">SMS Notifications</div>
          <div className="text-xs text-slate-400 mt-0.5">Receive notifications by text message.</div>
        </div>
        <button
          onClick={() => toggle("smsNotificationsEnabled")}
          className={`text-xs font-medium rounded-full px-3 py-1.5 ${
            prefs.smsNotificationsEnabled ? "text-emerald-700 bg-emerald-50" : "text-slate-500 bg-slate-100"
          }`}
        >
          {prefs.smsNotificationsEnabled ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security tab
// ---------------------------------------------------------------------------
type SessionRow = { id: string; userAgent: string | null; createdAt: string; expiresAt: string };

function SecurityTab() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);
  const [passwordChangedAt, setPasswordChangedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(() => {
    fetch("/api/account/security")
      .then((r) => r.json())
      .then((d) => {
        setSessions(d.sessions || []);
        setLastLoginAt(d.lastLoginAt || null);
        setPasswordChangedAt(d.passwordChangedAt || null);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function revokeSession(id: string) {
    await fetch(`/api/account/security/sessions/${id}`, { method: "DELETE" });
    load();
  }

  async function revokeAll() {
    await fetch("/api/account/security/revoke-all", { method: "POST" });
    setMessage("All other devices have been signed out.");
    load();
  }

  return (
    <div className="space-y-6">
      <PinSettings />
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500">Last Login</div>
            <div className="text-sm text-slate-800 mt-1">{lastLoginAt ? new Date(lastLoginAt).toLocaleString() : "—"}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">Last Password Change</div>
            <div className="text-sm text-slate-800 mt-1">{passwordChangedAt ? new Date(passwordChangedAt).toLocaleString() : "Never"}</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Active Sessions</h2>
          <button onClick={revokeAll} className="text-xs font-medium text-red-700 bg-red-50 rounded-md px-3 py-1.5">
            Logout From All Devices
          </button>
        </div>
        {message && <p className="text-xs text-emerald-700 mb-3">{message}</p>}
        <div className="space-y-2">
          {sessions.length === 0 && <p className="text-xs text-slate-400">No active sessions.</p>}
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between border-b border-slate-50 pb-2 last:border-0">
              <div>
                <div className="text-sm text-slate-800">{s.userAgent || "Unknown device"}</div>
                <div className="text-xs text-slate-400 mt-0.5">Signed in {new Date(s.createdAt).toLocaleString()}</div>
              </div>
              <button onClick={() => revokeSession(s.id)} className="text-xs font-medium text-slate-500 hover:text-red-700">
                Revoke
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
