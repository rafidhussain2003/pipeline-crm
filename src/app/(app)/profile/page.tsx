"use client";

import { useEffect, useState, useCallback } from "react";

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

type Session = { role: "super_admin" | "admin" | "agent"; companyId: string | null };

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

  const tabs: { id: Tab; label: string }[] = [
    ...(hasCompany ? [{ id: "company" as Tab, label: "Company" }] : []),
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

      {tab === "company" && hasCompany && <CompanyTab canEdit={isAdmin} />}
      {tab === "account" && <AccountTab />}
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

  useEffect(() => {
    fetch("/api/company-settings")
      .then((r) => r.json())
      .then((d) =>
        setForm({
          name: d.company?.name || "",
          logoUrl: d.company?.logoUrl || "",
          website: d.company?.website || "",
          address: d.company?.address || "",
          timezone: d.company?.timezone || "",
          supportEmail: d.company?.supportEmail || "",
          businessPhone: d.company?.businessPhone || "",
        })
      );
  }, []);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/company-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
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
function AccountTab() {
  const [name, setName] = useState("");
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
    const body: Record<string, string> = { name };
    // Only send email + password if the email field actually changed —
    // avoids asking for a password confirmation on a plain name edit.
    if (email !== originalEmail) {
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
        <h2 className="text-sm font-semibold text-slate-700">Owner Details</h2>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Owner Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Login Email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {email !== originalEmail && (
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
