"use client";

import { useEffect, useState, useCallback } from "react";

type Agent = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "super_admin" | "admin" | "manager" | "agent";
  tier: string | null;
  active: boolean;
  presenceStatus: string | null;
  lastHeartbeatAt: string | null;
  isOwner: boolean;
};

type Skill = { id: string; label: string };

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
};

function roleLabel(a: Agent) {
  if (a.isOwner) return "Owner";
  return ROLE_LABELS[a.role] || a.role;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

// Same "recently seen" heuristic as the presence dot elsewhere in the app —
// online if a heartbeat came in within the last 2 minutes.
function isOnline(a: Agent) {
  if (!a.lastHeartbeatAt) return false;
  return Date.now() - new Date(a.lastHeartbeatAt).getTime() < 2 * 60 * 1000;
}

const emptyForm = { name: "", email: "", phone: "", password: "", role: "agent" };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [myRole, setMyRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agentSkills, setAgentSkills] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [editing, setEditing] = useState<Agent | null>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "", role: "agent" });
  const [editError, setEditError] = useState("");

  const [resetting, setResetting] = useState<Agent | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (statusFilter) params.set("status", statusFilter);
    if (roleFilter) params.set("role", roleFilter);
    const res = await fetch(`/api/users?${params.toString()}`);
    const data = await res.json();
    setAgents(data.users || []);
    setLoading(false);
  }, [search, statusFilter, roleFilter]);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setMyRole(d.user?.role || ""));
    fetch("/api/skills")
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || []));
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const canManageAdmins = myRole === "admin";

  async function addAgent() {
    setError("");
    setSubmitting(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong");
      return;
    }
    setForm(emptyForm);
    setShowAdd(false);
    load();
  }

  function openEdit(a: Agent) {
    setEditing(a);
    setEditForm({ name: a.name, phone: a.phone || "", role: a.role });
    setEditError("");
  }

  async function saveEdit() {
    if (!editing) return;
    setEditError("");
    const res = await fetch(`/api/users/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editForm),
    });
    const data = await res.json();
    if (!res.ok) {
      setEditError(data.error || "Something went wrong");
      return;
    }
    setEditing(null);
    load();
  }

  async function loadAgentSkills(agentId: string) {
    const res = await fetch(`/api/users/${agentId}/skills`);
    const data = await res.json();
    setAgentSkills((prev) => ({ ...prev, [agentId]: data.skillIds || [] }));
  }

  async function toggleExpand(agentId: string) {
    if (expanded === agentId) {
      setExpanded(null);
      return;
    }
    setExpanded(agentId);
    if (!agentSkills[agentId]) await loadAgentSkills(agentId);
  }

  async function updateTier(agentId: string, tier: string) {
    setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, tier } : a)));
    await fetch(`/api/users/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
  }

  async function toggleSkill(agentId: string, skillId: string) {
    const current = agentSkills[agentId] || [];
    const has = current.includes(skillId);
    if (has) {
      await fetch(`/api/users/${agentId}/skills?skillId=${skillId}`, { method: "DELETE" });
      setAgentSkills((prev) => ({ ...prev, [agentId]: current.filter((s) => s !== skillId) }));
    } else {
      await fetch(`/api/users/${agentId}/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      setAgentSkills((prev) => ({ ...prev, [agentId]: [...current, skillId] }));
    }
  }

  async function toggleActive(a: Agent) {
    await fetch(`/api/users/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !a.active }),
    });
    load();
  }

  async function removeAgent(a: Agent) {
    if (!confirm(`Delete ${a.name}? Their past leads and history stay intact.`)) return;
    const res = await fetch(`/api/users/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Something went wrong");
      return;
    }
    load();
  }

  async function submitReset() {
    if (!resetting) return;
    setResetError("");
    if (resetPassword.length < 8) {
      setResetError("Temporary password must be at least 8 characters.");
      return;
    }
    const res = await fetch(`/api/users/${resetting.id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: resetPassword }),
    });
    const data = await res.json();
    if (!res.ok) {
      setResetError(data.error || "Something went wrong");
      return;
    }
    setResetting(null);
    setResetPassword("");
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Agents</h1>
        <button
          onClick={() => {
            setForm(emptyForm);
            setError("");
            setShowAdd(true);
          }}
          className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-slate-800"
        >
          Add Agent
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">Manage your team's access, roles, and account status.</p>

      <div className="flex items-center gap-2 mb-4">
        <input
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm"
        >
          <option value="">All roles</option>
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="agent">Agent</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {loading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
        {!loading && agents.length === 0 && <div className="p-4 text-sm text-slate-400">No agents found.</div>}
        {agents.map((a) => {
          const isAdminRow = a.role === "admin";
          const canEdit = canManageAdmins || !isAdminRow;
          const online = isOnline(a);
          return (
            <div key={a.id}>
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 text-xs font-semibold flex items-center justify-center shrink-0">
                  {initials(a.name)}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">{a.name}</div>
                  <div className="text-xs text-slate-400 truncate">
                    {a.email}
                    {a.phone ? ` · ${a.phone}` : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs font-medium rounded-full px-2.5 py-1 bg-slate-100 text-slate-600">{roleLabel(a)}</span>
                <span
                  className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                    online ? "text-emerald-600 bg-emerald-50" : "text-slate-400 bg-slate-100"
                  }`}
                >
                  {online ? "Online" : "Offline"}
                </span>
                <span
                  className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                    a.active ? "text-blue-700 bg-blue-50" : "text-slate-500 bg-slate-100"
                  }`}
                >
                  {a.active ? "Active" : "Disabled"}
                </span>
                {a.role === "agent" && (
                  <button onClick={() => toggleExpand(a.id)} className="text-xs font-medium text-slate-500 bg-slate-100 rounded-md px-2 py-1 hover:bg-slate-200">
                    Tier / Skills
                  </button>
                )}
                {canEdit && (
                  <>
                    <button onClick={() => openEdit(a)} className="text-xs font-medium text-slate-600 bg-slate-100 rounded-md px-2 py-1 hover:bg-slate-200">
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setResetting(a);
                        setResetPassword("");
                        setResetError("");
                      }}
                      className="text-xs font-medium text-slate-600 bg-slate-100 rounded-md px-2 py-1 hover:bg-slate-200"
                    >
                      Reset Password
                    </button>
                    <button
                      onClick={() => toggleActive(a)}
                      className="text-xs font-medium text-amber-700 bg-amber-50 rounded-md px-2 py-1 hover:bg-amber-100"
                    >
                      {a.active ? "Disable" : "Enable"}
                    </button>
                    <button onClick={() => removeAgent(a)} className="text-xs font-medium text-red-600 bg-red-50 rounded-md px-2 py-1 hover:bg-red-100">
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
            {expanded === a.id && (
              <div className="px-4 pb-4 flex flex-wrap items-center gap-2 border-t border-slate-50 pt-3">
                <select
                  value={a.tier || "1"}
                  onChange={(e) => updateTier(a.id, e.target.value)}
                  className="text-xs rounded-md border border-slate-200 px-2 py-1"
                >
                  <option value="1">Tier 1</option>
                  <option value="2">Tier 2</option>
                  <option value="3">Tier 3</option>
                </select>
                {skills.map((s) => {
                  const active = (agentSkills[a.id] || []).includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleSkill(a.id, s.id)}
                      className={`text-xs font-medium rounded-full px-3 py-1 border ${
                        active ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-400"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
                {skills.length === 0 && <span className="text-xs text-slate-400">No skills defined yet — add some in Pipeline Settings.</span>}
              </div>
            )}
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-4">Add Agent</h2>
            <div className="space-y-3">
              <input
                placeholder="Full name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                placeholder="Phone (optional)"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                placeholder="Temporary password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="agent">Agent</option>
                <option value="manager">Manager</option>
                {canManageAdmins && <option value="admin">Admin</option>}
              </select>
            </div>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="text-sm font-medium text-slate-500 px-3 py-2 rounded-md hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={addAgent}
                disabled={submitting || !form.name || !form.email || !form.password}
                className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
              >
                {submitting ? "Adding…" : "Add Agent"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-4">Edit {editing.name}</h2>
            <div className="space-y-3">
              <input
                placeholder="Full name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                placeholder="Phone"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                disabled={editing.isOwner}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="agent">Agent</option>
                <option value="manager">Manager</option>
                {canManageAdmins && <option value="admin">Admin</option>}
              </select>
              {editing.isOwner && <p className="text-xs text-slate-400">The company owner's role can't be changed.</p>}
            </div>
            {editError && <p className="text-sm text-red-600 mt-2">{editError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)} className="text-sm font-medium text-slate-500 px-3 py-2 rounded-md hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={saveEdit} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {resetting && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setResetting(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Reset password</h2>
            <p className="text-sm text-slate-500 mb-4">Set a new temporary password for {resetting.name}. They'll be signed out everywhere.</p>
            <input
              placeholder="New temporary password"
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            />
            {resetError && <p className="text-sm text-red-600 mt-2">{resetError}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setResetting(null)} className="text-sm font-medium text-slate-500 px-3 py-2 rounded-md hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={submitReset} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
