"use client";

import { useEffect, useState } from "react";

type Agent = { id: string; name: string; email: string; role: string; tier: string | null; active: boolean };
type Skill = { id: string; label: string };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agentSkills, setAgentSkills] = useState<Record<string, string[]>>({});
  const [form, setForm] = useState({ name: "", email: "", password: "", tier: "1" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function load() {
    const [agentsRes, skillsRes] = await Promise.all([fetch("/api/users"), fetch("/api/skills")]);
    const agentsData = await agentsRes.json();
    const skillsData = await skillsRes.json();
    setAgents(agentsData.users || []);
    setSkills(skillsData.skills || []);
  }

  useEffect(() => {
    load();
  }, []);

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
    setForm({ name: "", email: "", password: "", tier: "1" });
    load();
  }

  async function updateTier(id: string, tier: string) {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, tier } : a)));
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
  }

  async function toggleActive(id: string, active: boolean) {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, active } : a)));
    await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
  }

  async function removeAgent(id: string) {
    if (!confirm("Remove this agent? Their past leads and history stay intact.")) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Agents & Tiers</h1>
      <p className="text-sm text-slate-500 mb-6">
        Assign each agent to Tier 1, 2, or 3, and optionally to one or more skills for skill-based assignment.
      </p>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <input
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            placeholder="Temporary password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={form.tier}
            onChange={(e) => setForm({ ...form, tier: e.target.value })}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
        </div>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        <button
          onClick={addAgent}
          disabled={submitting || !form.name || !form.email || !form.password}
          className="mt-3 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md disabled:opacity-40"
        >
          {submitting ? "Adding…" : "Add Agent"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        {agents.map((a) => (
          <div key={a.id}>
            <div className="p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900">{a.name}</div>
                <div className="text-xs text-slate-400">{a.email} · {a.role}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.role === "agent" && (
                  <>
                    <select
                      value={a.tier || "1"}
                      onChange={(e) => updateTier(a.id, e.target.value)}
                      className="text-xs rounded-md border border-slate-200 px-2 py-1"
                    >
                      <option value="1">Tier 1</option>
                      <option value="2">Tier 2</option>
                      <option value="3">Tier 3</option>
                    </select>
                    <button onClick={() => toggleExpand(a.id)} className="text-xs font-medium text-slate-500 bg-slate-100 rounded-md px-2 py-1">
                      Skills
                    </button>
                  </>
                )}
                <button
                  onClick={() => toggleActive(a.id, !a.active)}
                  className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                    a.active ? "text-emerald-600 bg-emerald-50" : "text-slate-500 bg-slate-100"
                  }`}
                >
                  {a.active ? "Active" : "Inactive"}
                </button>
                <button onClick={() => removeAgent(a.id)} className="text-xs font-medium text-red-600 bg-red-50 rounded-md px-2 py-1">
                  Remove
                </button>
              </div>
            </div>
            {expanded === a.id && (
              <div className="px-4 pb-4 flex flex-wrap gap-2">
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
        ))}
        {agents.length === 0 && <div className="p-4 text-sm text-slate-400">No agents yet.</div>}
      </div>
    </div>
  );
}
