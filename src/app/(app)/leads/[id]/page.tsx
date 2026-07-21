"use client";

import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import LeadCallbacks from "@/components/callbacks/LeadCallbacks";
import ScheduleCallbackModal from "@/components/callbacks/ScheduleCallbackModal";
import { isSafeHttpUrl } from "@/lib/url";

// Enterprise Lead Workspace — the same Lead Detail page, restructured into a
// three-panel working surface (customer info / activity / quick actions) so
// an agent can work a customer end-to-end without leaving. Every capability
// that existed before (AI insights, tags, attachments, callbacks, priority /
// blacklist controls) is still here — moved, not removed.

type LeadDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  state: string | null;
  disposition: string;
  ownerId: string | null;
  ownerName: string | null;
  followUpAt: string | null;
  priority: string;
  isBlacklisted: boolean;
  isDuplicate: boolean;
  createdAt: string;
  updatedAt: string;
  sourceName: string | null;
  sourcePlatform: string | null;
  formName: string | null;
};

type Note = { id: string; body: string; createdAt: string; editedAt: string | null; authorId: string | null; authorName: string | null };
type Attachment = { id: string; fileName: string; fileUrl: string; createdAt: string };
type Tag = { id: string; label: string; color: string };
type TimelineEvent = { id: string; at: string; label: string; detail: string | null; actor: string | null };
type Disposition = { id: string; label: string; color: string; category?: string };
type Assignee = { id: string; name: string; role: string; online: boolean; openLeadCount: number };

// The follow-up engine's verdict (computed server-side in the detail route).
type FollowUp = {
  nextAction: string;
  dueAt: string | null;
  priority: "urgent" | "high" | "normal" | "low";
  reason: string;
  dueBucket: "overdue" | "today" | "tomorrow" | "upcoming" | "none";
};

const FOLLOWUP_PRIORITY_STYLES: Record<FollowUp["priority"], string> = {
  urgent: "text-red-700 bg-red-50",
  high: "text-amber-700 bg-amber-50",
  normal: "text-slate-600 bg-slate-100",
  low: "text-slate-400 bg-slate-50",
};

const DUE_BUCKET_STYLES: Record<FollowUp["dueBucket"], { label: string; cls: string } | null> = {
  overdue: { label: "Overdue", cls: "text-red-700 bg-red-50" },
  today: { label: "Today", cls: "text-amber-700 bg-amber-50" },
  tomorrow: { label: "Tomorrow", cls: "text-sky-700 bg-sky-50" },
  upcoming: null,
  none: null,
};

// Dispositions that end outbound dialing: the workspace's Call/SMS actions
// go dark and the phone renders as plain text (Part 1 — Wrong Number / DNC).
const NO_DIAL_DISPOSITIONS = new Set(["Do Not Call", "Wrong Number"]);

// Note-required dispositions (Part 1): the disposition saves only together
// with a short note explaining it.
const NOTE_REQUIRED: Record<string, { title: string; placeholder: string }> = {
  "Hung Up": { title: "Customer hung up", placeholder: "What happened on the call?" },
  "High Price": { title: "Pricing objection", placeholder: "What price/offer did the customer object to?" },
  "Not Interested": { title: "Not interested — why?", placeholder: "Reason the customer gave…" },
};

// Callback-suggested dispositions (Part 1): saving offers — never forces —
// a callback.
const CALLBACK_SUGGESTED = new Set(["No Answer", "Busy", "Voicemail Left"]);

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

// Mirrors DISPOSITION_CATEGORIES in src/lib/dispositions/taxonomy.ts (not
// imported: that module sits beside server-only code, this file ships to the
// browser).
const CATEGORY_ORDER = ["NEW", "CONTACT ATTEMPT", "INTERESTED", "SALES", "LOST", "OTHER"];

function leadAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  if (ms < 0) return "—";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

export default function LeadWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [viewerRole, setViewerRole] = useState<string>("");
  const [viewerUserId, setViewerUserId] = useState<string>("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [leadTagIds, setLeadTagIds] = useState<string[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const [insight, setInsight] = useState<Insight | null>(null);
  const [customerInsights, setCustomerInsights] = useState<CustomerInsights | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [actionError, setActionError] = useState("");

  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [attachName, setAttachName] = useState("");
  const [attachUrl, setAttachUrl] = useState("");
  const noteInputRef = useRef<HTMLTextAreaElement>(null);

  // Counters driving LeadCallbacks (open its modal / refresh its list).
  const [cbOpenRequest, setCbOpenRequest] = useState(0);
  const [cbRefresh, setCbRefresh] = useState(0);

  // Disposition special flows (Lead Workspace + Follow-up & Pipeline specs).
  const [confirmDnc, setConfirmDnc] = useState(false);
  const [saleClosedOpen, setSaleClosedOpen] = useState(false);
  const [installDate, setInstallDate] = useState("");
  const [saleNote, setSaleNote] = useState("");
  // Which callback-promising disposition is pending ("Call Back Later" or
  // "Call Back") — it applies only after the callback is actually booked.
  const [callBackLaterOpen, setCallBackLaterOpen] = useState<string | null>(null);
  // Note-required flow (Hung Up / High Price / Not Interested).
  const [noteGate, setNoteGate] = useState<{ disposition: string; title: string; placeholder: string } | null>(null);
  const [gateNote, setGateNote] = useState("");
  // Suggest-a-callback flow (No Answer / Busy / Voicemail Left).
  const [suggestCallbackFor, setSuggestCallbackFor] = useState<string | null>(null);
  // Duplicate Lead linking flow.
  const [dupOpen, setDupOpen] = useState(false);
  const [dupCandidates, setDupCandidates] = useState<{ id: string; name: string | null; phone: string | null; email: string | null; createdAt: string }[]>([]);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupSelected, setDupSelected] = useState<string | null>(null);

  const [assignOpen, setAssignOpen] = useState(false);

  const canAssign = viewerRole === "admin" || viewerRole === "manager";
  const isAdmin = viewerRole === "admin";

  // One parallel batch for everything above the fold — the page's data
  // arrives in a single round-trip's worth of latency, and the same batch is
  // re-run silently by the realtime stream (no flicker: state is replaced,
  // never cleared first).
  const load = useCallback(async () => {
    const [leadRes, notesRes, attRes, tagsRes, leadTagsRes, timelineRes] = await Promise.all([
      fetch(`/api/leads/${id}/detail`),
      fetch(`/api/leads/${id}/notes`),
      fetch(`/api/leads/${id}/attachments`),
      fetch("/api/tags"),
      fetch(`/api/leads/${id}/tags`),
      fetch(`/api/leads/${id}/timeline`),
    ]);
    if (!leadRes.ok) {
      setLoadFailed(true);
      return;
    }
    const leadData = await leadRes.json();
    const notesData = await notesRes.json().catch(() => ({}));
    const attData = await attRes.json().catch(() => ({}));
    const tagsData = await tagsRes.json().catch(() => ({}));
    const leadTagsData = await leadTagsRes.json().catch(() => ({}));
    const timelineData = await timelineRes.json().catch(() => ({}));
    setLead(leadData.lead || null);
    setFollowUp(leadData.followUp || null);
    setViewerRole(leadData.viewerRole || "");
    setViewerUserId(leadData.viewerUserId || "");
    setNotes(notesData.notes || []);
    setAttachments(attData.attachments || []);
    setAllTags(tagsData.tags || []);
    setLeadTagIds(leadTagsData.tagIds || []);
    setTimeline(timelineData.events || []);
  }, [id]);

  // AI Insights load separately (they recompute on read) so they never block
  // the rest of the workspace rendering.
  const loadInsights = useCallback(async () => {
    const res = await fetch(`/api/leads/${id}/insights`);
    if (!res.ok) return;
    const data = await res.json();
    setInsight(data.insight || null);
    setCustomerInsights(data.customerInsights || null);
  }, [id]);

  useEffect(() => {
    load();
    loadInsights();
  }, [load, loadInsights]);

  // Dispositions are company config — fetched once per mount, not per reload.
  useEffect(() => {
    fetch("/api/dispositions")
      .then(async (r) => {
        if (r.ok) setDispositions((await r.json()).dispositions || []);
      })
      .catch(() => {});
  }, []);

  // --- Realtime ------------------------------------------------------------
  // One SSE subscription per open workspace. A "lead.updated" /
  // "lead.assigned" frame for THIS lead re-runs the load batch silently, so
  // two people working the same customer see each other's notes, disposition
  // changes, callbacks and reassignments without refreshing. Agents receive
  // payload-less frames (server strips ids), so they refetch on any signal —
  // their queries are owner-scoped server-side anyway.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const scheduleReload = (payload: string) => {
      let leadId: string | undefined;
      try {
        leadId = (JSON.parse(payload) as { leadId?: string }).leadId;
      } catch {
        /* payload-less agent frame */
      }
      if (leadId && leadId !== id) return; // some other lead — not our concern
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        loadRef.current();
        setCbRefresh((n) => n + 1);
      }, 400);
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/leads/stream");
      es.addEventListener("ready", () => {
        attempt = 0;
      });
      es.addEventListener("lead.updated", (e) => scheduleReload((e as MessageEvent).data));
      es.addEventListener("lead.assigned", (e) => scheduleReload((e as MessageEvent).data));
      es.onerror = () => {
        es?.close();
        es = null;
        if (stopped) return;
        attempt += 1;
        retry = setTimeout(connect, Math.min(1000 * 2 ** (attempt - 1), 30_000));
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      es?.close();
    };
  }, [id]);

  // --- Lead field updates --------------------------------------------------

  async function patchLead(patch: Record<string, unknown>): Promise<boolean> {
    setActionError("");
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Could not save that change.");
      return false;
    }
    return true;
  }

  async function updateLeadField(patch: Partial<Pick<LeadDetail, "priority" | "isBlacklisted">>) {
    const previous = lead;
    setLead((prev) => (prev ? { ...prev, ...patch } : prev));
    const ok = await patchLead(patch);
    if (!ok && previous) setLead(previous);
  }

  // Optimistic, reversible disposition apply — same discipline as the leads
  // list page: the UI never shows a state the database refused.
  async function applyDisposition(next: string, extra?: Record<string, unknown>) {
    const previous = lead?.disposition;
    setLead((prev) => (prev ? { ...prev, disposition: next } : prev));
    const ok = await patchLead({ disposition: next, ...(extra || {}) });
    if (!ok) {
      if (previous !== undefined) setLead((prev) => (prev ? { ...prev, disposition: previous } : prev));
      return;
    }
    load();
  }

  // The Quick Actions disposition select — Part 1's disposition rules. Each
  // disposition routes into its workflow; anything without a rule applies
  // immediately.
  function handleDispositionPick(next: string) {
    if (!lead || next === lead.disposition) return;
    if (next === "Do Not Call") {
      setConfirmDnc(true);
      return;
    }
    if (next === "Call Back Later" || next === "Call Back") {
      // Mandatory callback: the disposition only saves after one is booked.
      setCallBackLaterOpen(next);
      return;
    }
    if (next === "Sale Closed") {
      setInstallDate("");
      setSaleNote("");
      setSaleClosedOpen(true);
      return;
    }
    const gate = NOTE_REQUIRED[next];
    if (gate) {
      setGateNote("");
      setNoteGate({ disposition: next, ...gate });
      return;
    }
    if (CALLBACK_SUGGESTED.has(next)) {
      setSuggestCallbackFor(next);
      return;
    }
    if (next === "Duplicate Lead") {
      openDuplicateFlow();
      return;
    }
    applyDisposition(next);
  }

  // Duplicate Lead: offer linking to the original. Candidates come from the
  // normal (owner-scoped for agents) leads search on this customer's own
  // phone/email — "if available", never mandatory.
  async function openDuplicateFlow() {
    setDupSelected(null);
    setDupCandidates([]);
    setDupOpen(true);
    const query = lead?.phone || lead?.email || lead?.name;
    if (!query) return;
    setDupLoading(true);
    try {
      const res = await fetch(`/api/leads?search=${encodeURIComponent(query)}&pageSize=50`);
      if (res.ok) {
        const data = await res.json();
        setDupCandidates(
          ((data.leads || []) as { id: string; name: string | null; phone: string | null; email: string | null; createdAt: string }[]).filter(
            (l) => l.id !== id
          )
        );
      }
    } catch {
      /* candidates are best-effort */
    } finally {
      setDupLoading(false);
    }
  }

  async function saveNoteGated() {
    if (!noteGate || !gateNote.trim()) return;
    const gate = noteGate;
    setNoteGate(null);
    await applyDisposition(gate.disposition);
    await fetch(`/api/leads/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: `${gate.disposition}: ${gateNote.trim()}` }),
    });
    setGateNote("");
    load();
  }

  // --- Notes ---------------------------------------------------------------

  async function addNote() {
    if (!newNote.trim()) return;
    const res = await fetch(`/api/leads/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newNote }),
    });
    if (res.ok) {
      setNewNote("");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Could not add the note.");
    }
  }

  async function saveNoteEdit() {
    if (!editingNoteId || !editBody.trim()) return;
    const res = await fetch(`/api/leads/${id}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteId: editingNoteId, body: editBody }),
    });
    if (res.ok) {
      setEditingNoteId(null);
      setEditBody("");
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setActionError(typeof data.error === "string" ? data.error : "Could not save the note.");
    }
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

  function focusNoteComposer() {
    noteInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    noteInputRef.current?.focus();
  }

  function colorFor(label: string) {
    return dispositions.find((d) => d.label === label)?.color || "#64748b";
  }

  const groupedDispositions = (() => {
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
    return ordered.map((category) => ({ category, options: groups.get(category)! }));
  })();

  // Part 1: Wrong Number / Do Not Call end outbound dialing from this page.
  const noDial = lead ? NO_DIAL_DISPOSITIONS.has(lead.disposition) : false;

  if (loadFailed) {
    return (
      <div className="p-6">
        <Link href="/leads" className="text-sm text-blue-600 mb-4 inline-block">
          ← Back to all leads
        </Link>
        <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-lg p-6">
          This lead is not available. It may have been removed or reassigned.
        </div>
      </div>
    );
  }
  if (!lead) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const infoRow = (label: string, value: React.ReactNode) => (
    <div className="py-2 border-b border-slate-100 last:border-0">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm text-slate-800 mt-0.5 break-words">{value ?? "—"}</div>
    </div>
  );

  return (
    <div className="p-6">
      <Link href="/leads" className="text-sm text-blue-600 mb-4 inline-block">
        ← Back to all leads
      </Link>

      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold text-slate-900">{lead.name || "Unknown"}</h1>
          <span
            className="text-xs font-medium rounded-full px-3 py-1"
            style={{ backgroundColor: `${colorFor(lead.disposition)}1a`, color: colorFor(lead.disposition) }}
          >
            {lead.disposition}
          </span>
          {lead.isDuplicate && (
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
              POSSIBLE DUPLICATE
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button
            onClick={() => updateLeadField({ priority: lead.priority === "high" ? "normal" : "high" })}
            className={`text-xs font-medium rounded-full px-3 py-1 ${
              lead.priority === "high" ? "text-amber-700 bg-amber-50" : "text-slate-500 bg-slate-100"
            }`}
          >
            {lead.priority === "high" ? "High Priority ✓" : "Mark High Priority"}
          </button>
          {/* Blacklisting is a supervisor decision (leads:supervise) — the
              server refuses everyone else, so everyone else doesn't see it. */}
          {isAdmin && (
            <button
              onClick={() => updateLeadField({ isBlacklisted: !lead.isBlacklisted })}
              className={`text-xs font-medium rounded-full px-3 py-1 ${
                lead.isBlacklisted ? "text-red-700 bg-red-50" : "text-slate-500 bg-slate-100"
              }`}
            >
              {lead.isBlacklisted ? "Blacklisted (no auto-assign) ✓" : "Blacklist from auto-assign"}
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          <span>{actionError}</span>
          <button onClick={() => setActionError("")} aria-label="Dismiss" className="shrink-0 text-red-700 hover:text-red-900">
            ×
          </button>
        </div>
      )}

      {/* Workspace: left = customer, center = activity, right = actions */}
      <div className="grid gap-6 items-start lg:grid-cols-[minmax(250px,300px)_minmax(0,1fr)_minmax(230px,270px)]">
        {/* ── LEFT: Customer Information ─────────────────────────────── */}
        <div className="space-y-6 min-w-0">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Customer Information</h2>
            {infoRow("Name", lead.name || "Unknown")}
            {infoRow(
              "Phone",
              lead.phone ? (
                noDial ? (
                  <span className="text-slate-400 line-through" title={`Dialing blocked — disposition is "${lead.disposition}"`}>
                    {lead.phone}
                  </span>
                ) : (
                  <a href={`tel:${lead.phone}`} className="text-blue-700 hover:underline">
                    {lead.phone}
                  </a>
                )
              ) : (
                "—"
              )
            )}
            {infoRow(
              "Email",
              lead.email ? (
                <a href={`mailto:${lead.email}`} className="text-blue-700 hover:underline">
                  {lead.email}
                </a>
              ) : (
                "—"
              )
            )}
            {lead.state && infoRow("Address / State", lead.state)}
            {lead.sourceName && infoRow("Lead Source", lead.sourceName)}
            {lead.formName && infoRow("Facebook Form", lead.formName)}
            {infoRow(
              lead.sourcePlatform === "facebook" ? "Original Facebook Created Time" : "Created",
              new Date(lead.createdAt).toLocaleString()
            )}
            {infoRow("Current Owner", lead.ownerName || <span className="text-slate-400">Unassigned</span>)}
            {infoRow(
              "Current Disposition",
              <span
                className="text-xs font-medium rounded-full px-2.5 py-0.5"
                style={{ backgroundColor: `${colorFor(lead.disposition)}1a`, color: colorFor(lead.disposition) }}
              >
                {lead.disposition}
              </span>
            )}
            {infoRow("Lead Age", leadAge(lead.createdAt))}
            {lead.followUpAt && infoRow("Follow-up", new Date(lead.followUpAt).toLocaleString())}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
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
              {allTags.length === 0 && <span className="text-xs text-slate-400">No tags yet.</span>}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Attachments</h2>
            <div className="space-y-2 mb-4">
              {attachments.map((a) =>
                // Second line of defence behind the API's http(s) check: rows
                // written before that validation existed render as inert text.
                isSafeHttpUrl(a.fileUrl) ? (
                  <a key={a.id} href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-600 hover:underline">
                    {a.fileName}
                  </a>
                ) : (
                  <span key={a.id} className="block text-sm text-slate-400" title="Link removed: not a valid http(s) URL">
                    {a.fileName}
                  </span>
                )
              )}
              {attachments.length === 0 && <p className="text-xs text-slate-400">No attachments yet.</p>}
            </div>
            <div className="space-y-2">
              <input
                value={attachName}
                onChange={(e) => setAttachName(e.target.value)}
                placeholder="File name"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={attachUrl}
                onChange={(e) => setAttachUrl(e.target.value)}
                placeholder="Link (Drive, Dropbox, etc.)"
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              />
              <button onClick={addAttachment} className="bg-slate-900 text-white text-xs font-medium px-3 py-2 rounded-md">
                Add attachment
              </button>
            </div>
          </div>
        </div>

        {/* ── CENTER: Activity ───────────────────────────────────────── */}
        <div className="space-y-6 min-w-0">
          {insight && (
            <div className={`bg-white border border-slate-200 rounded-lg p-5 ring-1 ${(TEMP_STYLES[insight.temperature] || TEMP_STYLES.cold).ring}`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${(TEMP_STYLES[insight.temperature] || TEMP_STYLES.cold).dot}`} />
                  AI Insights
                </h2>
                <span className="text-[10px] uppercase tracking-wide text-slate-400">AI-assisted · you decide</span>
              </div>
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
              <p className="text-sm text-slate-800 mb-4">{insight.summary}</p>
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

          {/* Notes — unlimited; author, time, edited indicator on each. */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Notes</h2>
            <textarea
              ref={noteInputRef}
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              rows={2}
              placeholder="Add a note…"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={addNote} className="mt-2 mb-4 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-md">
              Add note
            </button>
            <div className="space-y-3">
              {notes.map((n) => (
                <div key={n.id} className="border-b border-slate-100 pb-3 last:border-0">
                  {editingNoteId === n.id ? (
                    <div>
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={2}
                        className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={saveNoteEdit} className="text-xs font-semibold text-white bg-blue-600 rounded-md px-3 py-1">
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingNoteId(null);
                            setEditBody("");
                          }}
                          className="text-xs font-medium text-slate-500 px-2 py-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.body}</p>
                      <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                        <span>{n.authorName || "Unknown"}</span>
                        <span>· {new Date(n.createdAt).toLocaleString()}</span>
                        {n.editedAt && (
                          <span className="text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full px-1.5 py-0.5" title={`Edited ${new Date(n.editedAt).toLocaleString()}`}>
                            Edited
                          </span>
                        )}
                        {(n.authorId === viewerUserId || isAdmin) && (
                          <button
                            onClick={() => {
                              setEditingNoteId(n.id);
                              setEditBody(n.body);
                            }}
                            className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
                          >
                            Edit
                          </button>
                        )}
                      </p>
                    </>
                  )}
                </div>
              ))}
              {notes.length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
            </div>
          </div>

          <LeadCallbacks leadId={id} leadName={lead.name} openRequest={cbOpenRequest} refreshToken={cbRefresh} onChanged={load} />

          {/* Timeline — every recorded event, newest first (creation,
              assignments, notes, disposition changes, callbacks, and any
              audited email/SMS/call activity as it is recorded). */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
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

        {/* ── RIGHT: Next Action + Quick Actions ─────────────────────── */}
        <div className="space-y-6 lg:sticky lg:top-6">
          {/* Follow-up engine (Part 2): what to do next, when, how urgent. */}
          {followUp && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-700">Next Action</h2>
                <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${FOLLOWUP_PRIORITY_STYLES[followUp.priority]}`}>
                  {followUp.priority}
                </span>
              </div>
              <div className="text-sm font-medium text-slate-900">{followUp.nextAction}</div>
              <div className="text-xs text-slate-500 mt-1">{followUp.reason}</div>
              {followUp.dueAt && (
                <div className="flex items-center gap-2 mt-2">
                  {DUE_BUCKET_STYLES[followUp.dueBucket] && (
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${DUE_BUCKET_STYLES[followUp.dueBucket]!.cls}`}>
                      {DUE_BUCKET_STYLES[followUp.dueBucket]!.label}
                    </span>
                  )}
                  <span className="text-xs text-slate-600">{new Date(followUp.dueAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <QuickAction
                href={lead.phone && !noDial ? `tel:${lead.phone}` : undefined}
                label="Call"
                hint={noDial ? `Blocked — ${lead.disposition}` : lead.phone || "No phone number"}
              />
              <QuickAction
                href={lead.phone && !noDial ? `sms:${lead.phone}` : undefined}
                label="SMS"
                hint={noDial ? `Blocked — ${lead.disposition}` : lead.phone || "No phone number"}
              />
              <QuickAction href={lead.email ? `mailto:${lead.email}` : undefined} label="Email" hint={lead.email || "No email address"} />
              <button
                onClick={focusNoteComposer}
                className="w-full text-left text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-3 py-2"
              >
                Add Note
              </button>
              <button
                onClick={() => setCbOpenRequest((n) => n + 1)}
                className="w-full text-left text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-3 py-2"
              >
                Schedule Callback
              </button>
              {canAssign && (
                <button
                  onClick={() => setAssignOpen(true)}
                  className="w-full text-left text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-2"
                >
                  Assign
                </button>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <label htmlFor="workspace-disposition" className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                Change Disposition
              </label>
              <select
                id="workspace-disposition"
                value={lead.disposition}
                onChange={(e) => handleDispositionPick(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {groupedDispositions.map((g) => (
                  <optgroup key={g.category} label={g.category}>
                    {g.options.map((d) => (
                      <option key={d.id} value={d.label}>
                        {d.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {/* A legacy/custom value not in the configured list must still
                    render as selected rather than blanking the control. */}
                {!dispositions.some((d) => d.label === lead.disposition) && (
                  <option value={lead.disposition}>{lead.disposition}</option>
                )}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ── Modals ───────────────────────────────────────────────────── */}

      {/* Do Not Call — deliberate, confirmed action. */}
      {confirmDnc && (
        <WorkspaceModal title="Mark as Do Not Call?" onClose={() => setConfirmDnc(false)}>
          <p className="text-sm text-slate-600 mb-4">
            This marks the customer as <strong>Do Not Call</strong>. The lead is treated as closed and should not be
            contacted again.
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirmDnc(false)} className="text-sm font-medium text-slate-600 border border-slate-200 rounded-md px-3 py-1.5">
              Cancel
            </button>
            <button
              onClick={() => {
                setConfirmDnc(false);
                applyDisposition("Do Not Call");
              }}
              className="text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md px-3 py-1.5"
            >
              Confirm Do Not Call
            </button>
          </div>
        </WorkspaceModal>
      )}

      {/* Sale Closed — sales note REQUIRED, installation date optional. */}
      {saleClosedOpen && (
        <WorkspaceModal title="Sale Closed 🎉" onClose={() => setSaleClosedOpen(false)}>
          <label className="block text-xs font-medium text-slate-600 mb-1">Sales note (required)</label>
          <textarea
            value={saleNote}
            onChange={(e) => setSaleNote(e.target.value)}
            rows={2}
            placeholder="Package sold, price, anything the installer should know…"
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm mb-3"
          />
          <label className="block text-xs font-medium text-slate-600 mb-1">Installation date (optional)</label>
          <input
            type="datetime-local"
            value={installDate}
            onChange={(e) => setInstallDate(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm mb-4"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setSaleClosedOpen(false)} className="text-sm font-medium text-slate-600 border border-slate-200 rounded-md px-3 py-1.5">
              Cancel
            </button>
            <button
              disabled={!saleNote.trim()}
              onClick={async () => {
                setSaleClosedOpen(false);
                const followUpAt = installDate ? new Date(installDate).toISOString() : undefined;
                await applyDisposition("Sale Closed", followUpAt ? { followUpAt } : undefined);
                const body =
                  `Sale Closed: ${saleNote.trim()}` +
                  (followUpAt ? `\nInstallation scheduled for ${new Date(followUpAt).toLocaleString()}` : "");
                await fetch(`/api/leads/${id}/notes`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ body }),
                });
                setSaleNote("");
                load();
              }}
              className="text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md px-3 py-1.5 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </WorkspaceModal>
      )}

      {/* Note-required dispositions (Hung Up / High Price / Not Interested). */}
      {noteGate && (
        <WorkspaceModal title={noteGate.title} onClose={() => setNoteGate(null)}>
          <p className="text-sm text-slate-600 mb-3">
            Saving “{noteGate.disposition}” needs a short note so the next person understands what happened.
          </p>
          <textarea
            value={gateNote}
            onChange={(e) => setGateNote(e.target.value)}
            rows={3}
            placeholder={noteGate.placeholder}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm mb-4"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setNoteGate(null)} className="text-sm font-medium text-slate-600 border border-slate-200 rounded-md px-3 py-1.5">
              Cancel
            </button>
            <button
              disabled={!gateNote.trim()}
              onClick={saveNoteGated}
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </WorkspaceModal>
      )}

      {/* Suggest-a-callback dispositions (No Answer / Busy / Voicemail Left). */}
      {suggestCallbackFor && (
        <WorkspaceModal title={`${suggestCallbackFor} — schedule a callback?`} onClose={() => setSuggestCallbackFor(null)}>
          <p className="text-sm text-slate-600 mb-4">
            You didn’t reach the customer. Booking a callback keeps this lead moving — or save without one.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                const d = suggestCallbackFor;
                setSuggestCallbackFor(null);
                applyDisposition(d);
              }}
              className="text-sm font-medium text-slate-600 border border-slate-200 rounded-md px-3 py-1.5"
            >
              Save only
            </button>
            <button
              onClick={() => {
                const d = suggestCallbackFor;
                setSuggestCallbackFor(null);
                applyDisposition(d);
                setCbOpenRequest((n) => n + 1);
              }}
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5"
            >
              Save & Schedule Callback
            </button>
          </div>
        </WorkspaceModal>
      )}

      {/* Duplicate Lead — offer linking to the original (if findable). */}
      {dupOpen && (
        <WorkspaceModal title="Duplicate Lead" onClose={() => setDupOpen(false)}>
          <p className="text-sm text-slate-600 mb-3">
            If this duplicates another lead, link it to the original so history stays connected.
          </p>
          <div className="max-h-56 overflow-y-auto mb-4 space-y-1">
            {dupLoading && <div className="py-4 text-center text-sm text-slate-400">Searching…</div>}
            {!dupLoading && dupCandidates.length === 0 && (
              <div className="py-4 text-center text-sm text-slate-400">No matching leads found — you can still save.</div>
            )}
            {dupCandidates.map((c) => (
              <button
                key={c.id}
                onClick={() => setDupSelected((prev) => (prev === c.id ? null : c.id))}
                className={`w-full text-left rounded-md border px-3 py-2 ${
                  dupSelected === c.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="block text-sm font-medium text-slate-900 truncate">{c.name || "Unknown"}</span>
                <span className="block text-xs text-slate-500 truncate">
                  {c.phone || "—"} · {c.email || "—"} · {new Date(c.createdAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setDupOpen(false);
                applyDisposition("Duplicate Lead");
              }}
              className="text-sm font-medium text-slate-600 border border-slate-200 rounded-md px-3 py-1.5"
            >
              Save without linking
            </button>
            <button
              disabled={!dupSelected}
              onClick={() => {
                setDupOpen(false);
                applyDisposition("Duplicate Lead", { duplicateOfLeadId: dupSelected });
              }}
              className="text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md px-3 py-1.5 disabled:opacity-40"
            >
              Link & Save
            </button>
          </div>
        </WorkspaceModal>
      )}

      {/* Call Back Later / Call Back — REQUIRE a scheduled callback; the
          disposition is applied only after the callback is actually saved. */}
      {callBackLaterOpen && (
        <ScheduleCallbackModal
          leadId={id}
          leadName={lead.name}
          onClose={() => setCallBackLaterOpen(null)}
          onSaved={() => {
            const pending = callBackLaterOpen;
            setCallBackLaterOpen(null);
            setCbRefresh((n) => n + 1);
            applyDisposition(pending);
          }}
        />
      )}

      {assignOpen && (
        <WorkspaceAssignModal
          leadId={id}
          onClose={() => setAssignOpen(false)}
          onAssigned={() => {
            setAssignOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function QuickAction({ href, label, hint }: { href?: string; label: string; hint: string }) {
  if (!href) {
    return (
      <div className="w-full text-sm font-medium text-slate-300 bg-slate-50 border border-slate-100 rounded-md px-3 py-2 cursor-not-allowed" title={hint}>
        {label}
        <span className="block text-[11px] font-normal text-slate-300">{hint}</span>
      </div>
    );
  }
  return (
    <a href={href} className="block w-full text-sm font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md px-3 py-2">
      {label}
      <span className="block text-[11px] font-normal text-slate-400">{hint}</span>
    </a>
  );
}

function WorkspaceModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm bg-white rounded-lg shadow-xl border border-slate-200 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-slate-900 mb-3">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// The workspace's single-lead Assign picker — same roster endpoint and same
// assignment API as the leads page's bulk modal, for one lead.
function WorkspaceAssignModal({ leadId, onClose, onAssigned }: { leadId: string; onClose: () => void; onAssigned: () => void }) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [assigningId, setAssigningId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads/assignees")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Could not load the team list");
        setAssignees((await r.json()).assignees || []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load the team list"))
      .finally(() => setLoading(false));
  }, []);

  async function pick(agentId: string) {
    if (assigningId) return;
    setAssigningId(agentId);
    setError("");
    const res = await fetch("/api/leads/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds: [leadId], agentId }),
    });
    if (res.ok) {
      onAssigned();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(typeof data.error === "string" ? data.error : "Could not assign the lead.");
      setAssigningId(null);
    }
  }

  return (
    <WorkspaceModal title="Assign Lead" onClose={onClose}>
      {error && (
        <div role="alert" className="mb-3 text-sm bg-red-50 border border-red-100 text-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}
      <div className="max-h-72 overflow-y-auto -mx-1 px-1">
        {loading && <div className="py-6 text-center text-sm text-slate-400">Loading team…</div>}
        {!loading && assignees.length === 0 && !error && (
          <div className="py-6 text-center text-sm text-slate-400">No active team members to assign to.</div>
        )}
        {assignees.map((a) => (
          <button
            key={a.id}
            onClick={() => pick(a.id)}
            disabled={!!assigningId}
            className="w-full flex items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${a.online ? "bg-emerald-500" : "bg-slate-300"}`} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900 truncate">
                  {assigningId === a.id ? "Assigning…" : a.name}
                </span>
                <span className="block text-xs text-slate-500">
                  {a.online ? "Online" : "Offline"} · {a.openLeadCount} open
                </span>
              </span>
            </span>
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-slate-100 rounded-full px-2 py-0.5">
              {a.role}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 text-right">
        <button onClick={onClose} className="text-sm font-medium text-slate-600 border border-slate-200 rounded-md px-3 py-1.5">
          Cancel
        </button>
      </div>
    </WorkspaceModal>
  );
}
