"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mailbox = { id: string; address: string; displayName: string | null; unread: number };
type Label = { id: string; name: string; color: string };
type ListMessage = {
  id: string;
  threadId: string;
  folder: string;
  fromAddress: string;
  toAddresses: string[];
  subject: string | null;
  snippet: string | null;
  isRead: boolean;
  isStarred: boolean;
  isDraft?: boolean;
  direction: string;
  createdAt: string;
  msgCount?: number;
};
type Attachment = { id: string; filename: string; contentType: string | null; size: number | null };
type ThreadMessage = ListMessage & {
  ccAddresses: string[] | null;
  htmlBody: string | null;
  textBody: string | null;
  sentAt: string | null;
  attachments: Attachment[];
  labelIds: string[];
};

const FOLDERS = [
  { id: "inbox", label: "Inbox" },
  { id: "starred", label: "Starred" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
  { id: "trash", label: "Trash" },
];

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] || "";
}

type ComposeState = {
  open: boolean;
  mode: "new" | "reply" | "replyAll" | "forward";
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyToMessageId: string | null;
  attachments: { filename: string; contentType: string; contentBase64: string }[];
  showCc: boolean;
};

const EMPTY_COMPOSE: ComposeState = {
  open: false,
  mode: "new",
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  body: "",
  inReplyToMessageId: null,
  attachments: [],
  showCc: false,
};

export default function MailboxPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);
  const [sendConfigured, setSendConfigured] = useState(true);
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const [folder, setFolder] = useState("inbox");
  const [messages, setMessages] = useState<ListMessage[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ subject: string | null; messages: ThreadMessage[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState<ComposeState>(EMPTY_COMPOSE);
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const labelById = new Map(labels.map((l) => [l.id, l]));

  const loadBootstrap = useCallback(async () => {
    const res = await fetch("/api/mailbox");
    if (!res.ok) return;
    const data = await res.json();
    setMailboxes(data.mailboxes || []);
    setLabels(data.labels || []);
    setSendConfigured(data.sendConfigured);
    if (!mailboxId && data.mailboxes?.[0]) setMailboxId(data.mailboxes[0].id);
  }, [mailboxId]);

  const loadMessages = useCallback(async () => {
    if (!mailboxId) return;
    setLoading(true);
    const url = activeSearch
      ? `/api/mailbox/${mailboxId}/messages?q=${encodeURIComponent(activeSearch)}`
      : `/api/mailbox/${mailboxId}/messages?folder=${folder}`;
    const res = await fetch(url);
    const data = await res.json();
    setMessages(data.messages || []);
    setLoading(false);
  }, [mailboxId, folder, activeSearch]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);
  useEffect(() => {
    loadMessages();
    setOpenThreadId(null);
    setThread(null);
  }, [loadMessages]);

  async function openThread(m: ListMessage) {
    if (m.isDraft) {
      // Editing a draft opens the composer prefilled instead of a thread view.
      setCompose({
        ...EMPTY_COMPOSE,
        open: true,
        mode: "new",
        to: m.toAddresses.join(", "),
        subject: m.subject || "",
        body: m.snippet || "",
      });
      return;
    }
    setOpenThreadId(m.threadId);
    const res = await fetch(`/api/mailbox/thread/${m.threadId}`);
    const data = await res.json();
    setThread({ subject: data.thread?.subject ?? null, messages: data.messages || [] });
    loadBootstrap(); // refresh unread counts (opening marks read)
    setMessages((prev) => prev.map((x) => (x.threadId === m.threadId ? { ...x, isRead: true } : x)));
  }

  async function toggleStar(m: ListMessage, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/mailbox/message/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isStarred: !m.isStarred }),
    });
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, isStarred: !x.isStarred } : x)));
  }

  async function threadAction(action: "archive" | "trash" | "inbox") {
    if (!openThreadId) return;
    await fetch(`/api/mailbox/thread/${openThreadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: action }),
    });
    setOpenThreadId(null);
    setThread(null);
    loadMessages();
  }

  function startReply(mode: "reply" | "replyAll" | "forward") {
    if (!thread || thread.messages.length === 0) return;
    const last = thread.messages[thread.messages.length - 1];
    const box = mailboxes.find((b) => b.id === mailboxId);
    const quoted = `<br><br>--- On ${new Date(last.createdAt).toLocaleString()}, ${last.fromAddress} wrote: ---<br><blockquote style="border-left:2px solid #ccc;padding-left:8px;color:#555">${last.htmlBody || last.textBody || ""}</blockquote>`;
    const subjPrefix = mode === "forward" ? "Fwd: " : "Re: ";
    const baseSubject = (thread.subject || last.subject || "").replace(/^((re|fw|fwd)\s*:\s*)+/i, "");
    let to = "";
    let cc = "";
    if (mode === "reply") to = last.direction === "inbound" ? last.fromAddress : last.toAddresses.join(", ");
    if (mode === "replyAll") {
      to = last.fromAddress;
      cc = [...(last.toAddresses || []), ...(last.ccAddresses || [])].filter((a) => a && a !== box?.address).join(", ");
    }
    setCompose({
      ...EMPTY_COMPOSE,
      open: true,
      mode,
      to,
      cc,
      showCc: !!cc,
      subject: subjPrefix + baseSubject,
      body: mode === "forward" ? quoted : quoted,
      inReplyToMessageId: mode === "forward" ? null : last.id,
    });
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    const encoded = await Promise.all(
      files.map(async (f) => ({ filename: f.name, contentType: f.type || "application/octet-stream", contentBase64: await fileToBase64(f) }))
    );
    setCompose((c) => ({ ...c, attachments: [...c.attachments, ...encoded] }));
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submitCompose(saveDraft: boolean) {
    if (!mailboxId) return;
    setSending(true);
    setBanner("");
    const res = await fetch("/api/mailbox/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mailboxId,
        to: compose.to,
        cc: compose.cc,
        bcc: compose.bcc,
        subject: compose.subject,
        html: compose.body.replace(/\n/g, "<br>"),
        inReplyToMessageId: compose.inReplyToMessageId,
        attachments: compose.attachments,
        saveDraft,
      }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) {
      setBanner(data.error || "Could not send.");
      return;
    }
    setCompose(EMPTY_COMPOSE);
    loadMessages();
    loadBootstrap();
    if (openThreadId) openThread({ threadId: openThreadId } as ListMessage);
  }

  async function addLabel() {
    const name = prompt("New label name:");
    if (!name) return;
    await fetch("/api/mailbox/labels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    loadBootstrap();
  }

  async function toggleLabelOnMessage(messageId: string, labelId: string, has: boolean) {
    await fetch(`/api/mailbox/message/${messageId}/label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labelId, action: has ? "remove" : "add" }),
    });
    if (openThreadId) {
      const res = await fetch(`/api/mailbox/thread/${openThreadId}`);
      const data = await res.json();
      setThread({ subject: data.thread?.subject ?? null, messages: data.messages || [] });
    }
  }

  return (
    <div className="flex h-[calc(100vh-0px)]">
      {/* Left rail */}
      <div className="w-52 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-3">
          <button
            onClick={() => setCompose({ ...EMPTY_COMPOSE, open: true })}
            className="w-full bg-blue-600 text-white text-sm font-medium rounded-md py-2 hover:bg-blue-700"
          >
            Compose
          </button>
        </div>
        <div className="px-3 pb-2">
          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Mailbox</div>
          {mailboxes.map((b) => (
            <button
              key={b.id}
              onClick={() => setMailboxId(b.id)}
              className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center justify-between ${
                mailboxId === b.id ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className="truncate">{b.displayName || b.address}</span>
              {b.unread > 0 && <span className="text-[10px] bg-blue-600 text-white rounded-full px-1.5">{b.unread}</span>}
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-slate-100">
          {FOLDERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFolder(f.id);
                setActiveSearch("");
                setSearch("");
              }}
              className={`w-full text-left px-2 py-1.5 rounded text-sm ${
                folder === f.id && !activeSearch ? "bg-slate-100 text-slate-900 font-medium" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Labels</span>
            <button onClick={addLabel} className="text-xs text-blue-600">+ Add</button>
          </div>
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-2 py-1 text-sm text-slate-600">
              <span className="w-2 h-2 rounded-full" style={{ background: l.color }} />
              <span className="truncate">{l.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Message list */}
      <div className="w-96 shrink-0 border-r border-slate-200 bg-white flex flex-col">
        <div className="p-3 border-b border-slate-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setActiveSearch(search.trim());
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mail…"
              className="w-full text-sm rounded-md border border-slate-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </form>
          {!sendConfigured && (
            <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 rounded p-1.5">
              Sending isn&apos;t configured — add RESEND_API_KEY to send/receive real mail.
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-sm text-slate-400">Loading…</div>}
          {!loading && messages.length === 0 && <div className="p-4 text-sm text-slate-400">Nothing here.</div>}
          {messages.map((m) => (
            <button
              key={m.id}
              onClick={() => openThread(m)}
              className={`w-full text-left px-3 py-2.5 border-b border-slate-50 hover:bg-slate-50 ${
                openThreadId === m.threadId ? "bg-blue-50" : ""
              } ${!m.isRead ? "bg-white" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span
                  onClick={(e) => toggleStar(m, e)}
                  className={`cursor-pointer text-sm ${m.isStarred ? "text-amber-400" : "text-slate-300"}`}
                >
                  ★
                </span>
                <span className={`flex-1 truncate text-sm ${!m.isRead ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                  {m.direction === "inbound" ? m.fromAddress : `To: ${m.toAddresses.join(", ")}`}
                </span>
                {m.msgCount && m.msgCount > 1 && <span className="text-[10px] text-slate-400">{m.msgCount}</span>}
                <span className="text-[11px] text-slate-400 shrink-0">{fmtTime(m.createdAt)}</span>
              </div>
              <div className={`text-sm truncate ${!m.isRead ? "font-medium text-slate-800" : "text-slate-600"}`}>
                {m.isDraft && <span className="text-red-600 mr-1">[Draft]</span>}
                {m.subject || "(no subject)"}
              </div>
              <div className="text-xs text-slate-400 truncate">{m.snippet}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Thread / reading pane */}
      <div className="flex-1 bg-slate-50 flex flex-col min-w-0">
        {!thread && <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Select a conversation</div>}
        {thread && (
          <>
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between gap-3">
              <h1 className="text-base font-semibold text-slate-900 truncate">{thread.subject || "(no subject)"}</h1>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => threadAction("archive")} className="text-xs text-slate-600 bg-slate-100 rounded px-2 py-1 hover:bg-slate-200">Archive</button>
                <button onClick={() => threadAction("trash")} className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 hover:bg-red-100">Trash</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {thread.messages.map((m) => (
                <div key={m.id} className="bg-white border border-slate-200 rounded-lg">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900">{m.fromAddress}</div>
                      <div className="text-xs text-slate-500 truncate">
                        to {m.toAddresses.join(", ")}
                        {m.ccAddresses && m.ccAddresses.length > 0 && `, cc ${m.ccAddresses.join(", ")}`}
                      </div>
                    </div>
                    <div className="text-xs text-slate-400 shrink-0">{new Date(m.createdAt).toLocaleString()}</div>
                  </div>
                  {/* Email HTML rendered in a sandboxed iframe (no scripts) so a
                      malicious sender can't run JS in the super-admin session. */}
                  <iframe
                    title={`msg-${m.id}`}
                    sandbox=""
                    className="w-full border-0"
                    style={{ height: 320 }}
                    srcDoc={`<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;margin:12px">${
                      m.htmlBody || (m.textBody || "").replace(/\n/g, "<br>")
                    }</body></html>`}
                  />
                  {m.attachments.length > 0 && (
                    <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={`/api/mailbox/attachment/${a.id}`}
                          className="text-xs text-blue-600 bg-blue-50 rounded px-2 py-1 hover:bg-blue-100"
                        >
                          📎 {a.filename}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="px-4 py-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                    {labels.map((l) => {
                      const has = m.labelIds.includes(l.id);
                      return (
                        <button
                          key={l.id}
                          onClick={() => toggleLabelOnMessage(m.id, l.id, has)}
                          className={`text-[11px] rounded-full px-2 py-0.5 border ${has ? "text-white" : "text-slate-500 border-slate-200"}`}
                          style={has ? { background: l.color, borderColor: l.color } : {}}
                        >
                          {l.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white border-t border-slate-200 px-5 py-3 flex gap-2">
              <button onClick={() => startReply("reply")} className="text-sm font-medium text-white bg-slate-900 rounded-md px-3 py-1.5">Reply</button>
              <button onClick={() => startReply("replyAll")} className="text-sm font-medium text-slate-700 bg-slate-100 rounded-md px-3 py-1.5">Reply All</button>
              <button onClick={() => startReply("forward")} className="text-sm font-medium text-slate-700 bg-slate-100 rounded-md px-3 py-1.5">Forward</button>
            </div>
          </>
        )}
      </div>

      {/* Compose modal */}
      {compose.open && (
        <div className="fixed inset-0 bg-black/20 flex items-end justify-end p-4 z-50">
          <div className="bg-white w-full max-w-lg rounded-lg shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]">
            <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-lg">
              <span className="text-sm font-semibold text-slate-800">
                {compose.mode === "new" ? "New Message" : compose.mode === "forward" ? "Forward" : "Reply"}
              </span>
              <button onClick={() => setCompose(EMPTY_COMPOSE)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
            </div>
            <div className="p-4 space-y-2 overflow-y-auto">
              <input
                value={compose.to}
                onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                placeholder="To"
                className="w-full text-sm border-b border-slate-200 px-1 py-1.5 focus:outline-none focus:border-blue-500"
              />
              {compose.showCc && (
                <>
                  <input value={compose.cc} onChange={(e) => setCompose({ ...compose, cc: e.target.value })} placeholder="Cc" className="w-full text-sm border-b border-slate-200 px-1 py-1.5 focus:outline-none focus:border-blue-500" />
                  <input value={compose.bcc} onChange={(e) => setCompose({ ...compose, bcc: e.target.value })} placeholder="Bcc" className="w-full text-sm border-b border-slate-200 px-1 py-1.5 focus:outline-none focus:border-blue-500" />
                </>
              )}
              {!compose.showCc && (
                <button onClick={() => setCompose({ ...compose, showCc: true })} className="text-xs text-blue-600">Add Cc/Bcc</button>
              )}
              <input
                value={compose.subject}
                onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                placeholder="Subject"
                className="w-full text-sm border-b border-slate-200 px-1 py-1.5 focus:outline-none focus:border-blue-500"
              />
              <textarea
                value={compose.body}
                onChange={(e) => setCompose({ ...compose, body: e.target.value })}
                placeholder="Write your message…"
                rows={10}
                className="w-full text-sm px-1 py-1.5 focus:outline-none resize-none"
              />
              {compose.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {compose.attachments.map((a, i) => (
                    <span key={i} className="text-xs bg-slate-100 rounded px-2 py-1 flex items-center gap-1">
                      📎 {a.filename}
                      <button onClick={() => setCompose({ ...compose, attachments: compose.attachments.filter((_, j) => j !== i) })} className="text-slate-400">×</button>
                    </span>
                  ))}
                </div>
              )}
              {banner && <div className="text-xs text-red-600">{banner}</div>}
            </div>
            <div className="px-4 py-2.5 border-t border-slate-100 flex items-center gap-2">
              <button onClick={() => submitCompose(false)} disabled={sending} className="text-sm font-medium text-white bg-blue-600 rounded-md px-4 py-1.5 disabled:opacity-50">
                {sending ? "Sending…" : "Send"}
              </button>
              <button onClick={() => submitCompose(true)} disabled={sending} className="text-sm font-medium text-slate-600 bg-slate-100 rounded-md px-3 py-1.5">Save Draft</button>
              <input ref={fileRef} type="file" multiple onChange={onPickFiles} className="hidden" id="mailbox-file" />
              <label htmlFor="mailbox-file" className="text-sm text-slate-500 cursor-pointer px-2">📎 Attach</label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
