"use client";

import { useEffect, useState } from "react";

type Rule = { id: string; tier: string; weight: number; active: boolean };
type Disposition = { id: string; label: string; color: string; category?: string };
type Tag = { id: string; label: string; color: string };
type Skill = { id: string; label: string };

// Mirrors DISPOSITION_CATEGORIES in src/lib/dispositions/taxonomy.ts (not
// imported: that module sits beside server-only code). The category decides
// which group the new disposition appears under in every agent's dropdown.
const CATEGORY_ORDER = ["NEW", "CONTACT ATTEMPT", "INTERESTED", "SALES", "LOST", "OTHER"];

// A small, readable palette for custom dispositions — same colors the
// seeded taxonomy uses per category, so custom entries fit right in.
const DISPOSITION_COLORS = ["#2563eb", "#d97706", "#0891b2", "#16a34a", "#dc2626", "#64748b", "#7c3aed", "#db2777"];

export default function PipelinePage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState("OTHER");
  const [newColor, setNewColor] = useState(DISPOSITION_COLORS[0]);
  const [dispositionError, setDispositionError] = useState("");
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
    if (!newLabel.trim()) return;
    setDispositionError("");
    // Errors must be visible — previously a duplicate label's 409 was
    // silently swallowed and the admin believed the disposition was created.
    let res: Response;
    try {
      res = await fetch("/api/dispositions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), category: newCategory, color: newColor }),
      });
    } catch {
      setDispositionError("Could not save — network error. Try again.");
      return;
    }
    if (!res.ok) {
      setDispositionError((await res.json().catch(() => ({}))).error || "Could not create the disposition.");
      return;
    }
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
        <p className="text-xs text-slate-400 mb-3">
          Grouped exactly as agents see them in every disposition dropdown. Custom dispositions become available to
          agents immediately.
        </p>
        <div className="bg-white border border-slate-200 rounded-lg mb-3 p-3 space-y-3">
          {(() => {
            const groups = new Map<string, Disposition[]>();
            for (const d of dispositions) {
              const cat = d.category || "OTHER";
              const list = groups.get(cat);
              if (list) list.push(d);
              else groups.set(cat, [d]);
            }
            const ordered = [
              ...CATEGORY_ORDER.filter((c) => groups.has(c)),
              ...[...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
            ];
            return ordered.map((category) => (
              <div key={category}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{category}</div>
                <div className="flex flex-wrap gap-1.5">
                  {groups.get(category)!.map((d) => (
                    <span
                      key={d.id}
                      className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-2.5 py-1"
                      style={{ backgroundColor: `${d.color}1a`, color: d.color }}
                    >
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>
            ));
          })()}
          {dispositions.length === 0 && <p className="text-sm text-slate-400">No dispositions yet.</p>}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="New disposition label"
            className="flex-1 min-w-[180px] rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            aria-label="Category for the new disposition"
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
          >
            {CATEGORY_ORDER.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Color for the new disposition">
            {DISPOSITION_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setNewColor(c)}
                aria-label={`Color ${c}`}
                className={`w-6 h-6 rounded-full border-2 ${newColor === c ? "border-slate-900" : "border-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <button onClick={addDisposition} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            Add
          </button>
        </div>
        {dispositionError && <p className="text-xs text-red-600 mt-2">{dispositionError}</p>}
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
