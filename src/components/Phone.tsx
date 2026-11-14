"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { PublicPerson, ThreadMessage } from "@/lib/types";

const SUGGESTIONS = [
  "from 8-9 I planted trees",
  "harvested carrots from the carrot row from 3-4pm",
  "weeded the carrot row for an hour",
  "schedule kumquats from 4-5 today",
  "what's on the schedule this week?",
  "what needs watering?",
  "undo",
];

export function Phone({
  people,
  threads,
  newSender,
  onSent,
}: {
  people: PublicPerson[];
  threads: Record<string, ThreadMessage[]>;
  newSender: { available: boolean; thread: ThreadMessage[] };
  onSent: (info: { sessionId: string | null; sessionStart: string | null; personId: string | null }) => Promise<void>;
}) {
  const [sender, setSender] = useState(people[0]?.id ?? "new");
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ThreadMessage[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isNew = sender === "new";
  const person = people.find((item) => item.id === sender) ?? null;
  const thread = preview ?? (isNew ? newSender.thread : threads[sender] ?? []);

  useEffect(() => {
    setPreview(null);
  }, [threads, newSender, sender]);

  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [thread, sending]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text && !file) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          imageDataUrl: file,
          ...(isNew ? { asNew: true } : { personId: sender }),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        thread?: ThreadMessage[];
        sessionId: string | null;
        sessionStart: string | null;
        personId: string | null;
      };
      if (!response.ok) {
        setError(body.error || "The text didn't send.");
        return;
      }
      setDraft("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      if (body.thread) setPreview(body.thread);
      if (body.personId && isNew) setSender(body.personId);
      await onSent({
        sessionId: body.sessionId,
        sessionStart: body.sessionStart,
        personId: body.personId,
      });
    } catch {
      setError("The text didn't send.");
    } finally {
      setSending(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    const reader = new FileReader();
    reader.onload = () => setFile(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(picked);
  }

  return (
    <div className="phone-col">
      <div className="who" role="tablist" aria-label="Who is texting">
        {people.map((item) => (
          <button
            key={item.id}
            type="button"
            className={sender === item.id ? "on" : ""}
            style={{ ["--swatch" as string]: item.color }}
            onClick={() => setSender(item.id)}
          >
            {item.name}
          </button>
        ))}
        <button type="button" className={isNew ? "on" : ""} onClick={() => setSender("new")}>
          New
        </button>
      </div>
      <div className="phone">
        <div className="ear" />
        <div className="screen">
          <div className="sms-bar">
            <strong>Garden log</strong>
            <span>{person?.name ?? "New volunteer"}</span>
          </div>
          <div className="thread" ref={scroller}>
            {thread.length === 0 ? (
              <p className="empty-thread">Text what you did. A block shows up on the week.</p>
            ) : (
              thread.map((message) => (
                <div key={message.id} className={message.direction === "in" ? "bubble in" : "bubble out"}>
                  {message.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={message.imageUrl} alt="" />
                  ) : null}
                  {message.text ? <p>{message.text}</p> : null}
                </div>
              ))
            )}
          </div>
          {file ? (
            <div className="attach">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={file} alt="Photo to send" />
              <button type="button" onClick={() => setFile(null)} aria-label="Remove photo">
                ×
              </button>
            </div>
          ) : null}
          <form onSubmit={send}>
            <label className="clip">
              <span className="sr">Attach a photo</span>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={onFile} />
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M4 7h3l2-2h6l2 2h3v12H4z" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            </label>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={person ? `Text as ${person.name}` : "Text as someone new"}
              aria-label="Text message"
              maxLength={1000}
            />
            <button type="submit" disabled={sending || (!draft.trim() && !file)}>
              {sending ? "…" : "Send"}
            </button>
          </form>
          {error ? <p className="phone-error">{error}</p> : null}
        </div>
      </div>
      <div className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button key={suggestion} type="button" onClick={() => setDraft(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
