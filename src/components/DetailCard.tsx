"use client";

import { workPhrase } from "@/lib/phrases";
import { detailWhen } from "@/lib/time";
import type { Bed, Photo, Planting, PublicPerson, Task, WorkSession } from "@/lib/types";

export function DetailCard({
  session,
  task,
  people,
  beds,
  plantings,
  photos,
  timezone,
}: {
  session: WorkSession | null;
  task: Task | null;
  people: PublicPerson[];
  beds: Bed[];
  plantings: Planting[];
  photos: Photo[];
  timezone: string;
}) {
  if (session) {
    const person = people.find((item) => item.id === session.person_id);
    const bed = beds.find((item) => item.id === session.bed_id);
    const planting = plantings.find((item) => item.id === session.planting_id);
    const pictures = photos.filter((photo) => photo.session_id === session.id);
    const phrase = workPhrase(session.activity_type, planting?.crop ?? null, bed?.name ?? null);
    const summary = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
    const extraNotes = session.notes && session.notes.trim() !== summary ? session.notes : "";
    return (
      <article className="detail">
        <header>
          <i style={{ background: person?.color ?? "#888" }} />
          <div>
            <h3>{person?.name ?? "Volunteer"}</h3>
            <p>{detailWhen(new Date(session.start), new Date(session.end), timezone)}</p>
          </div>
        </header>
        <p className="did">{summary}</p>
        {extraNotes ? <p className="notes">{extraNotes}</p> : null}
        {pictures.map((photo) => (
          <figure key={photo.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={photo.caption} />
            <figcaption>{photo.caption}</figcaption>
          </figure>
        ))}
        <blockquote>“{session.raw_message}”</blockquote>
      </article>
    );
  }

  if (task) {
    const bed = beds.find((item) => item.id === task.bed_id);
    const planting = plantings.find((item) => item.id === task.planting_id);
    return (
      <article className="detail">
        <header>
          <i className={`mark ${task.type === "water" ? "urgent" : task.type === "harvest" ? "upcoming" : task.type === "fill" ? "fill" : "meeting"}`} />
          <div>
            <h3>{task.title}</h3>
            <p>{task.severity === "urgent" ? "Urgent" : task.severity === "upcoming" ? "Coming up" : "Routine"}</p>
          </div>
        </header>
        <p className="did">{task.detail}</p>
        {bed ? <p className="notes">Bed: {bed.name}</p> : null}
        {planting ? <p className="notes">Crop: {planting.crop}</p> : null}
      </article>
    );
  }

  return <p className="hint">Click a block to see what they did.</p>;
}
