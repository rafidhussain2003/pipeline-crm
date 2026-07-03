"use client";

import { useEffect, useState } from "react";

type Rule = { id: string; tier: string; weight: number; active: boolean };
type Disposition = { id: string; label: string; color: string };
type Tag = { id: string; label: string; color: string };
type Skill = { id: string; label: string };

export default function PipelinePage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newSkill, setNewSkill] = useState("");

  async function load() {
    const [rulesRes, dispRes, tagsRes, skillsRes] = await Promise.all([
      fetch("/api/assignment-rules"),
      fetch("/api/dispositions"),
      fetch("/api/tags"),
      fetch("/api/skills"),
    ]);
    setRules((await rulesRes.json()).rules || []);
    setDispositions((await dispRes.json()).dispositions || []);
    setTags((await tagsRes.json()).tags || []);
    setSkills((await skillsRes.json()).skills || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function updateWeight(tier: string, weight: number) {
    setRules((prev) => prev.map((r) => (r.tier === tier ? { ...r, weight } : r)));
    await fetch("/api/assignment-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier, weight }),
    });
  }

  async function addDisposition() {
    if (!newLabel) return;
    await fetch("/api/dispositions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel }),
    });
    setNewLabel("");
    load();
  }

  async function addTag() {
    if (!newTag) return;
    await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newTag }),
    });
    setNewTag("");
    load();
  }

  async function addSkill() {
    if (!newSkill) return;
    await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newSkill }),
    });
    setNewSkill("");
    load();
  }

  return (
    <div className="p-6 max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Pipeline Settings</h1>
        <p className="text-sm text-slate-500 mb-6">
          Control how leads are distributed across tiers, and customize your disposition labels, tags, and skills.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Tier weights</h2>
        <p className="text-xs text-slate-400 mb-3">
          Used when Automation is set to Weighted mode. Higher weight = more leads.
        </p>
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
          {["1", "2", "3"].map((tier) => {
            const rule = rules.find((r) => r.tier === tier);
            return (
              <div key={tier} className="p-4 flex items-center justify-between">
                <span className="text-sm font-medium text-slate-900">Tier {tier}</span>
                <input
                  type="number"
                  min={0}
                  value={rule?.weight ?? 1}
                  onChange={(e) => updateWeight(tier, parseInt(e.target.value || "0", 10))}
                  className="w-20 rounded-md border border-slate-200 px-2 py-1 text-sm text-right"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Disposition options</h2>
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-3">
          {dispositions.map((d) => (
            <div key={d.id} className="p-3 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-sm text-slate-800">{d.label}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New disposition label"
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={addDisposition} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            Add
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Tags</h2>
        <p className="text-xs text-slate-400 mb-3">Applied to leads for categorization (e.g. product interest, campaign).</p>
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-3">
          {tags.map((t) => (
            <div key={t.id} className="p-3 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="text-sm text-slate-800">{t.label}</span>
            </div>
          ))}
          {tags.length === 0 && <div className="p-3 text-sm text-slate-400">No tags yet.</div>}
        </div>
        <div className="flex gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            placeholder="New tag"
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={addTag} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            Add
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Skills</h2>
        <p className="text-xs text-slate-400 mb-3">
          Assign to agents under Agents & Tiers. Used when Automation is set to Skill Based mode.
        </p>
        <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100 mb-3">
          {skills.map((s) => (
            <div key={s.id} className="p-3 text-sm text-slate-800">
              {s.label}
            </div>
          ))}
          {skills.length === 0 && <div className="p-3 text-sm text-slate-400">No skills yet.</div>}
        </div>
        <div className="flex gap-2">
          <input
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            placeholder="New skill (e.g. Spanish-speaking)"
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={addSkill} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
