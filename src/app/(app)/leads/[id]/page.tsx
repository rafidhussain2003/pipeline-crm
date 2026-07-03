"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

type LeadDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  disposition: string;
  ownerId: string | null;
  ownerName: string | null;
  isDuplicate: boolean;
  createdAt: string;
};

type Note = { id: string; body: string; createdAt: string; authorName: string | null };
type Attachment = { id: string; fileName: string; fileUrl: string; createdAt: string };
type Tag = { id: string; label: string; color: string };

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

  async function load() {
    const [leadRes, notesRes, attRes, tagsRes, leadTagsRes] = await Promise.all([
      fetch(`/api/leads/${id}/detail`),
      fetch(`/api/leads/${id}/notes`),
      fetch(`/api/leads/${id}/attachments`),
      fetch("/api/tags"),
      fetch(`/api/leads/${id}/tags`),
    ]);
    const leadData = await leadRes.json();
    const notesData = await notesRes.json();
    const attData = await attRes.json();
    const tagsData = await tagsRes.json();
    const leadTagsData = await leadTagsRes.json();
    setLead(leadData.lead || null);
    setNotes(notesData.notes || []);
    setAttachments(attData.attachments || []);
    setAllTags(tagsData.tags || []);
    setLeadTagIds(leadTagsData.tagIds || []);
  }

  useEffect(() => {
    load();
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
      </div>

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
    </div>
  );
}
