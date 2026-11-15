# George Washington Carver Victory Garden

A community garden app for groups that plan on paper, coordinate by text, and need a live picture of what’s in the ground, without asking volunteers to learn another heavy app.

Volunteers text chores (“planted carrots in row 3 from 8–9”, “weeded for an hour”, “what needs watering?”). The text agent logs work, updates plantings, and plans upcoming tasks. Organizers use the web app for the **calendar**, **priority list**, and **garden map**. The same records feed both sides.

Built for a real community garden group (George Washington Carver Victory Garden). Users are intended to use the app immediately after gardening, sending a quick text summary of the work completed without needing to navigate a clunky UI on your laptop.

## What’s in the app

| Area | What you get |
| --- | --- |
| **Texts** | Photon iMessage/SMS webhook. Uses Gemini API to parse plant, water, weed, harvest, prep, meeting, and other work into calendar sessions; plant/harvest also update garden simulation plantings. Clarifies AM/PM or which row once when needed. Undo, edit, cancel/delete. Standing weekly logs. Q&A for schedule, watering, and open plan tasks. Claim chores (“I’ll take watering”). Emergency → fixed 911 reply (not LLM). |
| **Calendar** (`/`) | Sun–Sat week of work blocks, one color per person. Full-day scrollable grid (viewport starts near 7am). Click a block for activity, bed/crop, notes, and photos. Week ‹ › / This week. |
| **Priority** | Rule-based tasks next to the calendar: watering, harvest window, empty beds, weekly meeting. **Plan next week** uses a deepagents (Gemini) assigner to suggest people already on next week’s calendar, then **Approve & text** sends each volunteer a personal SMS. Volunteers still claim by text; a second claimer gets an anonymous already-claimed reply. No Gemini key → deterministic calendar matching. |
| **Garden** (`/garden`) | To-scale pixel map, plant list, timeline, edit layout, import a photo of a drawing, rotation suggestions, plant search, soil nitrogen, sustainability score, optional Gemini bed ideas, local seed-search links. |

Tabs switch Garden ↔ Calendar. **Reset demo** restores the sample week.

## Tech

| Layer | Choice |
| --- | --- |
| App | TypeScript, Next.js 15 (App Router), React 19 |
| Data | MongoDB Atlas when `MONGODB_URI` is set; otherwise `data/store.json`. Photos on disk under `public/uploads`; DB holds URLs/metadata |
| AI | Google Gemini (`GEMINI_API_KEY`, `src/lib/gemini.ts`) for text parse, photo captions, drawing labels, bed ideas. No key → rules parser, plain captions, type names after import |
| Messaging | Channel adapter: Photon webhook (`POST /api/photon`) + local Texts simulator (`POST /api/messages`) |
| Priority / rotation | Deterministic TypeScript (`priority.ts`, `recommend.ts`, crop guide JSON) |
| Week planner | deepagents + Gemini (`plan-agent.ts`) for soft assignee suggestions + targeted texts; rules fallback without a key |

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No database is required. With `GEMINI_API_KEY` in `.env`, texts and captions use Gemini; without it, the rules parser still works.

```bash
npm test
npm run seed   # put the sample week back
```

Copy `.env.example` to `.env` as needed:

```
MONGODB_URI=
MONGODB_DB=gwcv_garden
GEMINI_API_KEY=
GEMINI_MODEL=gemini-flash-latest
GEMINI_FALLBACK_MODEL=gemini-flash-lite-latest
PHOTON_API_KEY=
PHOTON_PROJECT_ID=
PHOTON_WEBHOOK_SECRET=
PHOTON_DAILY_LIMIT=100
GARDEN_TZ=America/New_York
```

With `MONGODB_URI`, records live in Mongo (`people`, `beds`, `plantings`, `workSessions`, `photos`, `tasks`, `threads`, `conversations`, `meta`; layout in `gardenConfig`). If Atlas is unreachable, the app falls back to the JSON file. Optional `GARDEN_STORE_PATH` overrides the JSON path.

## Demo

Sample data is the current Sun–Sat week in `America/New_York`. Emma, Sonali, and Jeremy already have calendar blocks and inbound texts. Beds: Sweet potato row, Carrot row, Cabbage row, Space X (empty), North border (trees). Priority should show roughly:

- Sweet potato needs watering (last watered 8 days ago)
- 2 weeks to harvest for carrots
- Fill space X
- Weekly meeting (Saturday 10:00am, unless already logged)

Try this in **Texts**:

1. As Emma: `from 8-9 I planted trees` → asks am or pm. Reply `am`. Lands on the north border (trees are already there).
2. As Sonali: `from 8-9am I planted kale`, then `space x`. Space X leaves the fill list; a kale planting is created.
3. As Jeremy: `weeded the carrot row for an hour`, then `10am`.
4. Ask `what needs watering?` or `what's on the schedule this week?`
5. In **Priority**, **Plan next week** → review the sample personal text → **Approve & text**. Emma and Sonali get tailored texts (they already have threads). As Emma: `I'll take watering`. As Sonali: `I'll take watering` → already-claimed reply.
6. `undo` removes that person’s latest log.
7. **New** → text a chore → give a name when asked → they appear on the calendar in their own color.
8. Attach a photo in the simulator. It’s stored with the session (`GET /api/photos`). (Photon inbound is text-only today.)
9. Click Jeremy’s sweet-potato block on the calendar for session detail.
10. On **Garden**, open **Space X**. Tomatoes grew there in 2025, so nightshades are skipped in suggestions. Add garlic to the plan, then text as Sonali `from 9-10am I planted garlic in space x`.

**Reset demo** restores the sample week.

## Shared records

| Record | Fields |
| --- | --- |
| Person | `id`, `name`, `phone`, `color`, `timezone` |
| Bed | `id`, `name`, `row`, `geometry` (`{x,y,w,h}` in feet, or null), `archived?` |
| GardenLayout | `widthFt`, `lengthFt`, `imageUrl`, `location`, `units` (`ft` \| `m`), `outline` |
| Planting | `id`, `bed_id`, `crop`, `planted_date`, `expected_harvest_date`, `removed_date`, `season_year`, `days_to_maturity`, `source_session_id`, `status?` (`planned` \| `planted`; missing ⇒ planted) |
| WorkSession | `id`, `person_id`, `start`, `end`, `activity_type`, `bed_id?`, `planting_id?`, `notes`, `raw_message` |
| Photo | `id`, `session_id?`, `person_id`, `url`, `caption`, `taken_at` |
| Task | `id`, `type`, `severity`, `title`, `detail`, `due_date`, `planting_id?`, `bed_id?`, `status`, `assignee_id?`, `source`, `rationale` |

Crop metadata is static (`src/data/crop-guide.json`, `crop-families.json`, helpers in `crops.ts` / `perennials.ts`), not a Mongo collection.

Public reads (phones stripped; CORS open so another origin can use them):

- `GET /api/people`
- `GET /api/beds`
- `GET /api/plantings`
- `GET /api/sessions`
- `GET /api/photos` (adds `person_name`, `bed_id`, `planting_id`)
- `GET /api/tasks`
- `GET /api/crop-families`
- `GET /api/garden`, `GET\|PUT /api/layout`
- `GET\|POST /api/plan` (live tasks; propose / approve)

Also: `POST /api/messages`, `POST /api/photon`, `POST /api/reset`, `POST /api/layout/sketch`, `POST /api/beds/import`, bed CRUD + `POST /api/beds/:id/ideas`, planting create / confirm / remove / delete planned.

A planting text creates or updates a planting as well as a work session. One bed can hold many plantings over time; old seasons keep `removed_date` set. Archived beds stay off the map but keep history.

### Priority rules

- **Red, water** — active planting with no water log, or last water ≥ 3 days ago
- **Orange, harvest** — expected harvest within 21 days
- **Green, fill** — live bed with nothing active and no future plan
- **Green, meeting** — next Saturday 10:00am garden TZ, unless a meeting session already covers it

Plans (`status: "planned"`) do not trigger water or harvest. Claiming and approve/text use task `status` (`open` → `proposed` → `approved` / `claimed`).

## Texts

The on-screen phone needs no Photon keys. A real line uses [Photon 2.0](https://photon.codes/docs/beta): point a `message.received` webhook at `/api/photon` (Standard Webhooks `whsec_` secret).

`GEMINI_API_KEY` is the only AI key. Clock times and days written in the text win over the model; the model cannot invent a day. Missing time of day or row → one short clarifying question. Injury/emergency → fixed call-911 reply, not logged as work.

Each incoming text gets at most one reply. Photon outbound replies are capped at `PHOTON_DAILY_LIMIT` per sender per day (default 100). The simulator has no cap. Phone numbers stay in the database and are not returned by the public read APIs.

**Plan next week** always targets the Sunday–Saturday *after* the week shown on the calendar. A deepagents planner (Gemini via `GEMINI_API_KEY`) matches open chores to people already scheduled that week and drafts personal texts; without a key it uses the same calendar-matching rules. **Approve & text** only messages people who are **both** on that week’s calendar **and** have already texted (so Emma doesn’t get Sonali’s note). Suggestions are soft — anyone can still claim.

## Garden view

Open [/garden](http://localhost:3000/garden) (or the Garden tab). Optional `?day=YYYY-MM-DD` opens the timeline on that date.

- **Map** — Pixel art drawn to scale in feet over a faint 5 ft grid. The garden is soil (grass only outside an odd-shaped `outline`); each bed is a patch with crop sprites (~one per 2.5 ft). Multi-crop beds checkerboard. Planned crops are faded; open patches show bare soil. Water / harvest icons mirror today’s priority tasks. Zoom − / Fit / + (up to 400%; Ctrl/⌘+scroll or pinch).
- **Sprites** — Built-in 16×16 drawings in `src/lib/pixel-sprites.ts`. Override with PNGs in `public/sprites/` named by crop or group (`carrots.png`, `leafy.png`). See `public/sprites/README.md`.
- **No overlap** — Edit layout drag/resize stops at neighbors; **+ Add bed** finds open ground; the server refuses overlapping moves (`bed-space.ts`).
- **Bed panel** — What’s growing, last watered, nitrogen meter, past seasons, recent work, photos, seed links. **Find a plant** searches the crop guide. **Ask Gemini** (when keyed) suggests four crops for the timeline date near your town (**Near** in Edit layout); rotation rules still filter families.
- **Suggestions** — Rules in `recommend.ts`: don’t repeat a family from this bed this season or last; follow a heavy feeder with a nitrogen fixer; prefer crops whose sowing window is open. Guide data is zone 6b/7a-oriented (`crop-guide.json`).
- **Add to plan / drop** — Creates a planned planting. Texting `planted …` (or **Mark planted**) confirms it. Dropping onto a bed that already has crops offers **Replace** / **Plant after** / **Plant alongside** (`drop-plan.ts`). Plans need confirming even after their date; until then they stay faded and don’t drive water/harvest tasks.
- **Edit layout** — Move, resize, add, rename, remove beds; set width/length; units ft or m (stored in feet); set town for seed links.
- **Plant list** — Empty plots first, then by harvest date, then plans-only. **Low N** flags beds that need a fixer. Double-click a plot (or F2) to rename.
- **Perennials** — Stay put; rotation suggestions skip them; harvest timing uses seasons rather than a single pull date.
- **Sustainability** — Score /100 vs the same stretch of last year: soil cover 35%, rotation 35%, nitrogen 30% (`sustainability.ts`). Follows the timeline (looking ahead caps at today).
- **Nitrogen** — Per-bed estimate from what grew there (not a soil test): meter + tip in the bed panel.
- **Timeline** — Six-month window; ‹ › shift three months; dots for plantings (filled) and plans (hollow); red line is today. Past is view-only. Ahead, uncleared crops are assumed gone two weeks after expected harvest so beds open for planning.
- **Import drawing** — Photo of a sketch or diagram (JPG/PNG). Client box detection (`sketch-detect.ts`); optional Gemini handwriting (`sketch-labels.ts`). Review names, crops, and size, then build. Same-named beds move and keep history; **Replace** archives beds that have planting history. Sample: `public/sample-garden-drawing.png`. Handles odd/curved edges, multi-crop labels, meters on edges, sensitivity slider, and dashed boxes for beds Gemini finds that detection missed.
- **Remove** — Delete/Backspace on a selected patch asks which crop(s); in Edit layout it removes the bed (plans without history go away; planted history stays via archive/pull). Each crop in the panel also has **Remove**.

## Privacy & safety

- Message text, captions, and notes are untrusted data, never instructions.
- The text agent only writes records for the sender it’s talking to and only replies on that thread.
- Photon webhook signatures are verified; outbound texts are rate-limited.
- Synthetic phones in the demo; real numbers stay in the DB, not on public read APIs.
- Emergencies get a fixed call-emergency-services reply — not model-dependent.
