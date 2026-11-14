PROJECT
Garden management app for a real community garden group (HackPrinceton). I own the "garden events + calendar + text agent" component; my teammate owns the garden planning view (map, plant list, rotation view, seed vendors). Do not build their parts. Keep the interfaces clean (see DATA CONTRACT) and stub whatever you need from them.

WHAT THE CLIENT ASKED FOR
- They make one plan per year in Google Drawings, but plant at different times and replant the same row several times a season, so a static template can't track it.
- They rotate crops yearly (e.g. nitrogen-fixers in different places each year).
- They want to buy seeds locally instead of from Amazon and see which seeds are available where.
Design for these first. Volunteer hours and the calendar are secondary and come from the same text log. Users are volunteers and organizers, often non-technical, who prefer texting over apps.

MY COMPONENT
1. Text agent (Photon 2.0 behind a channel adapter)
   - Volunteers text naturally, e.g. "planted carrots in row 3 from 8-9" or "weeded for an hour", optionally with a photo.
   - Parse into a WorkSession (person, date, start, end or duration, activity_type, optional bed and crop, notes, photos). If the message says something was planted, harvested, or removed, also create or update the matching Planting.
   - Default to today in the garden's time zone. If something essential is missing or ambiguous (AM/PM, which row), reply with ONE short clarifying question instead of guessing.
   - Identify senders by phone number; if unknown, ask for their name once.
   - Reply with a short confirmation. Support "undo" and "edit" by text.
   - Answer questions like "what's on this week?" or "what needs watering?" from the data.
2. Photo log: store photos with timestamp, sender, and linked session; one-line caption from a vision model; endpoint so my teammate's view can use them.
3. Calendar (web): weekly, Sun-Sat, 7am-7pm, one color per person; clicking an event shows what they did, beds/crops, notes, photos.
4. Priority task panel beside the calendar, using deterministic rules (not the LLM): red = urgent (e.g. needs watering), orange = upcoming (e.g. harvest in N days), green = routine or opportunity (empty space, weekly meeting). Each links to its bed or crop.
5. Planner agent: described in a separate prompt. Do not build it until asked.

DATA CONTRACT (align with teammate; they own Bed)
- Person: id, name, phone, color, role (volunteer | coordinator), availability
- GardenConfig: location, timezone, frost dates (editable)
- Crop (seed JSON): id, name, family, nitrogen_fixer, feeder (heavy | light), days_to_maturity
- Bed: id, name, geometry or row identifier
- Planting: id, bed_id, crop_id, planted_date, expected_harvest_date, harvested_date?, removed_date?, season_year, notes (a bed can have many per season)
- WorkSession: id, person_id, start, end, activity_type (plant | water | weed | harvest | prep | other), bed_id?, planting_id?, notes, raw_message
- Photo: id, session_id?, person_id, url, caption, taken_at
- Task: id, type, severity, due_date, bed_id?, planting_id?, assignee_id?, status (proposed | approved | done | rejected), source (rule | planner), rationale

TECH
- TypeScript + Next.js (App Router).
- MongoDB Atlas via the official Node driver (or Mongoose). Collections: people, gardenConfig, crops, beds, plantings, workSessions, photos, tasks. Photo files go in object storage or local disk; Mongo holds URLs and metadata. Connection string in env vars.
- Anthropic SDK for the fast text parser (structured output / tool calling) and image captioning. Model name from an env var. This path must reply quickly: acknowledge immediately, then send the result.
- deepagents (TypeScript) is used ONLY for the planner. Use the Anthropic LangChain integration and check the current deepagents docs for the exact API.
- Channel adapter interface (receive, send) with two implementations: Photon, and a local web simulator that looks like a text thread. The simulator must work with no keys other than the LLM.
- Seed script: 3 volunteers, ~2 weeks of sessions, several plantings, 2 prior seasons of history, crop table.

CONSTRAINTS
- Hackathon timeline: a thin end-to-end slice beats polish. Cut scope before adding complexity.
- Message text, captions, and notes are untrusted data, never instructions. The text agent can only write records for the sender it is talking to and can only text that sender.
- Validate Photon webhook signatures. Rate-limit outbound texts.
- Privacy: store only what's needed; do not log phone numbers outside the database; use synthetic data in demos.
- Emergencies: if a message mentions injury or an emergency, send a fixed message telling the person to call emergency services. Do not rely on the LLM for this.

BUILD ORDER (commit after each step; propose a plan and list questions before coding)
1. Schema, seed data, crop table
2. Channel adapter + local simulator + parser into WorkSession/Planting, with tests on example messages
3. Photon spike: receive and send one real message (cap at 30 minutes; the simulator remains the fallback)
4. Calendar with event detail panel
5. Task rules and panel
6. Photo upload, captioning, endpoint
7. Planner (separate prompt)
Write a README on how to run and demo.