"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import LeadCallbacks from "@/components/callbacks/LeadCallbacks";

type LeadDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  disposition: string;
  ownerId: string | null;
  ownerName: string | null;
  priority: string;
  isBlacklisted: boolean;
  isDuplicate: boolean;
  createdAt: string;
};

type Note = { id: string; body: string; createdAt: string; authorName: string | null };
type Attachment = { id: string; fileName: string; fileUrl: string; createdAt: string };
type Tag = { id: string; label: string; color: string };
type TimelineEvent = { id: string; at: string; label: string; detail: string | null; actor: string | null };

type Insight = {
  score: number;
  scoreLabel: string;
  temperature: "hot" | "warm" | "cold";
  tags: string[];
  summary: string;
  recommendation: string;
  recommendationLabel: string;
  recommendationReason: string;
  followUpAt: string | null;
  followUpLabel: string;
  explanation: string[];
  factors: { label: string; points: number; maxPoints: number; reason: string }[];
  computedAt: string;
};
type CustomerInsights = {
  leadSource: string;
  firstContactAt: string;
  lastContactAt: string;
  daysOpen: number;
  assignmentCount: number;
  recycleCount: number;
  currentOwner: string | null;
  currentStatus: string;
  scoreLabel: string;
  recommendationLabel: string;
};

// Temperature → badge colors (the UI never string-matches the label; it uses
// the coarse temperature bucket from the insight).
const TEMP_STYLES: Record<string, { badge: string; ring: string; dot: string }> = {
  hot: { badge: "text-red-700 bg-red-50", ring: "ring-red-200", dot: "bg-red-500" },
  warm: { badge: "text-amber-700 bg-amber-50", ring: "ring-amber-200", dot: "bg-amber-500" },
  cold: { badge: "text-sky-700 bg-sky-50", ring: "ring-sky-200", dot: "bg-sky-500" },
};

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [leadTagIds, setLeadTagIds] = useState<string[]>([]);
  const [newNote, setNewNote] = useState("");
  const [attachName, setAttachName] = useState("");
  const [attachUrl, setAttachUrl] = useState("");
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [customerInsights, setCustomerInsights] = useState<CustomerInsights | null>(null);
  const [showWhy, setShowWhy] = useState(false);

  async function load() {
    const [leadRes, notesRes, attRes, tagsRes, leadTagsRes, timelineRes] = await Promise.all([
      fetch(`/api/leads/${id}/detail`),
      fetch(`/api/leads/${id}/notes`),
      fetch(`/api/leads/${id}/attachments`),
      fetch("/api/tags"),
      fetch(`/api/leads/${id}/tags`),
      fetch(`/api/leads/${id}/timeline`),
    ]);
    const leadData = await leadRes.json();
    const notesData = await notesRes.json();
    const attData = await attRes.json();
    const tagsData = await tagsRes.json();
    const leadTagsData = await leadTagsRes.json();
    const timelineData = await timelineRes.json();
    setLead(leadData.lead || null);
    setNotes(notesData.notes || []);
    setAttachments(attData.attachments || []);
    setAllTags(tagsData.tags || []);
    setLeadTagIds(leadTagsData.tagIds || []);
    setTimeline(timelineData.events || []);
  }

  // AI Insights load separately (it recomputes on read) so it never blocks the
  // rest of the page rendering.
  async function loadInsights() {
    const res = await fetch(`/api/leads/${id}/insights`);
    if (!res.ok) return;
    const data = await res.json();
    setInsight(data.insight || null);
    setCustomerInsights(data.customerInsights || null);
  }

  async function updateLeadField(patch: Partial<Pick<LeadDetail, "priority" | "isBlacklisted">>) {
    setLead((prev) => (prev ? { ...prev, ...patch } : prev));
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  useEffect(() => {
    load();
    loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function addNote() {
    if (!newNote.trim()) return;
    await fetch(`/api/leads/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newNote }),
    });
    setNewNote("");
    load();
  }

  async function addAttachment() {
    if (!attachName || !attachUrl) return;
    await fetch(`/api/leads/${id}/attachments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: attachName, fileUrl: attachUrl }),
    });
    setAttachName("");
    setAttachUrl("");
    load();
  }

  async function toggleTag(tagId: string) {
    const has = leadTagIds.includes(tagId);
    if (has) {
      await fetch(`/api/leads/${id}/tags?tagId=${tagId}`, { method: "DELETE" });
    } else {
      await fetch(`/api/leads/${id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
    }
    load();
  }

  if (!lead) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-3xl">
      <Link href="/leads" className="text-sm text-blue-600 mb-4 inline-block">
        ← Back to all leads
      </Link>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">{lead.name || "Unknown"}</h1>
          {lead.isDuplicate && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
              POSSIBLE DUPLICATE
            </span>
          )}
        </div>
        <div className="text-sm text-slate-500 mt-1">
          {lead.phone || "—"} · {lead.email || "—"}
        </div>
        <div className="text-sm text-slate-500 mt-1">
          Owner: {lead.ownerName || "Unassigned"} · Disposition: {lead.disposition}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => updateLeadField({ priority: lead.priority === "high" ? "normal" : "high" })}
            className={`text-xs font-medium rounded-full px-3 py-1 ${
              lead.priority === "high" ? "text-amber-700 bg-amber-50" : "text-slate-500 bg-slate-100"
            }`}
          >
            {lead.priority === "high" ? "High Priority ✓" : "Mark High Priority"}
          </button>
          <button
            onClick={() => updateLeadField({ isBlacklisted: !lead.isBlacklisted })}
            className={`text-xs font-medium rounded-full px-3 py-1 ${
              lead.isBlacklisted ? "text-red-700 bg-red-50" : "text-slate-500 bg-slate-100"
            }`}
          >
            {lead.isBlacklisted ? "Blacklisted (no auto-assign) ✓" : "Blacklist from auto-assign"}
          </button>
        </div>
      </div>

      {/* AI Insights (Phase 9) — one card. Recommendations only; the agent/admin
          stays in control. Everything shown is explained ("why"), never a bare score. */}
      {insight && (
        <div className={`bg-white border border-slate-200 rounded-lg p-5 mb-6 ring-1 ${(TEMP_STYLES[insight.temperature] || TEMP_STYLES.cold).ring}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${(TEMP_STYLES[insight.temperature] || TEMP_STYLES.cold).dot}`} />
              AI Insights
            </h2>
            <span className="text-[10px] uppercase tracking-wide text-slate-400">AI-assisted · you decide</span>
          </div>

          {/* Score + label + tags */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className={`text-sm font-semibold rounded-full px-3 py-1 ${(TEMP_STYLES[insight.temperature] || TEMP_STYLES.cold).badge}`}>
              {insight.scoreLabel} · {insight.score}/100
            </span>
            {insight.tags.map((t) => (
              <span key={t} className="text-[11px] font-medium text-slate-600 bg-slate-100 rounded-full px-2.5 py-1">
                {t}
              </span>
            ))}
          </div>

          {/* Summary */}
          <p className="text-sm text-slate-800 mb-4">{insight.summary}</p>

          {/* Next best action + follow-up */}
          <div className="grid sm:grid-cols-2 gap-3 mb-4">
            <div className="bg-slate-50 rounded-md p-3">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Next best action</div>
              <div className="text-sm font-medium text-slate-900">{insight.recommendationLabel}</div>
              <div className="text-xs text-slate-500 mt-1">{insight.recommendationReason}</div>
            </div>
            <div className="bg-slate-50 rounded-md p-3">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Follow-up</div>
              <div className={`text-sm font-medium ${insight.followUpLabel === "Reminder overdue" ? "text-red-600" : "text-slate-900"}`}>{insight.followUpLabel}</div>
              {insight.followUpAt && <div className="text-xs text-slate-500 mt-1">{new Date(insight.followUpAt).toLocaleString()}</div>}
            </div>
          </div>

          {/* Why (explanation) — never just a score */}
          <button onClick={() => setShowWhy((v) => !v)} className="text-xs font-medium text-blue-600">
            {showWhy ? "Hide why" : "Why this score & recommendation?"}
          </button>
          {showWhy && (
            <ul className="mt-2 space-y-1.5">
              {insight.explanation.map((e, i) => (
                <li key={i} className="text-xs text-slate-600 flex gap-2">
                  <span className="text-slate-400">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Customer Insights */}
          {customerInsights && (
            <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {[
                ["Lead source", customerInsights.leadSource],
                ["First contact", new Date(customerInsights.firstContactAt).toLocaleDateString()],
                ["Last contact", new Date(customerInsights.lastContactAt).toLocaleDateString()],
                ["Days open", String(customerInsights.daysOpen)],
                ["Assignments", String(customerInsights.assignmentCount)],
                ["Recycles", String(customerInsights.recycleCount)],
                ["Current owner", customerInsights.currentOwner || "Unassigned"],
                ["Current status", customerInsights.currentStatus],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
                  <div className="text-xs font-medium text-slate-800 truncate">{value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Callbacks (Phase 15) — the Schedule Callback button lives on every lead. */}
      <LeadCallbacks leadId={id} leadName={lead.name} />

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Tags</h2>
        <div className="flex flex-wrap gap-2">
          {allTags.map((t) => {
            const active = leadTagIds.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggleTag(t.id)}
                style={active ? { backgroundColor: `${t.color}1a`, color: t.color } : undefined}
                className={`text-xs font-medium rounded-full px-3 py-1 border ${
                  active ? "border-transparent" : "border-slate-200 text-slate-400"
                }`}
              >
                {t.label}
              </button>
            );
          })}
          {allTags.length === 0 && <span className="text-xs text-slate-400">No tags yet — add some in Pipeline Settings.</span>}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Notes</h2>
        <div className="space-y-3 mb-4">
          {notes.map((n) => (
            <div key={n.id} className="border-b border-slate-100 pb-3 last:border-0">
              <p className="text-sm text-slate-800">{n.body}</p>
              <p className="text-xs text-slate-400 mt-1">
                {n.authorName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
          {notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
        </div>
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          rows={2}
          placeholder="Add a note…"
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
        />
        <button onClick={addNote} className="mt-2 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
          Add note
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Attachments</h2>
        <div className="space-y-2 mb-4">
          {attachments.map((a) => (
            <a key={a.id} href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-600 hover:underline">
              {a.fileName}
            </a>
          ))}
          {attachments.length === 0 && <p className="text-xs text-slate-400">No attachments yet.</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={attachName}
            onChange={(e) => setAttachName(e.target.value)}
            placeholder="File name"
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            value={attachUrl}
            onChange={(e) => setAttachUrl(e.target.value)}
            placeholder="Link (Drive, Dropbox, etc.)"
            className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
          />
          <button onClick={addAttachment} className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
            Add
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mt-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Timeline</h2>
        <div className="space-y-3">
          {timeline.map((e) => (
            <div key={e.id} className="border-b border-slate-100 pb-3 last:border-0">
              <p className="text-sm text-slate-800">
                {e.label}
                {e.actor && <span className="text-slate-400"> · {e.actor}</span>}
              </p>
              {e.detail && <p className="text-xs text-slate-400 mt-0.5">{e.detail}</p>}
              <p className="text-xs text-slate-400 mt-0.5">{new Date(e.at).toLocaleString()}</p>
            </div>
          ))}
          {timeline.length === 0 && <p className="text-xs text-slate-400">No history yet.</p>}
        </div>
      </div>
    </div>
  );
}
