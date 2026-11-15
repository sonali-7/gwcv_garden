# Garden log

The people side of the community garden app: a weekly calendar of who did the work, a priority list, and a text thread that writes both.

It also has a garden view at [/garden](http://localhost:3000/garden): the garden drawn to scale, what's in each bed, and rotation-aware ideas for what to plant next. The two views share the same records, so a planting someone texts in shows up on the map.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No database is required. Messages are stored in `data/store.json`. With `GEMINI_API_KEY` in `.env`, texts are read by Gemini. Without a model key, a rules parser does the same job.

```bash
npm test
npm run seed   # put the sample week back
```

## Demo

The sample week is the current Sun–Sat, in America/New_York. Emma, Sonali, and Jeremy already have blocks. The priority list should show:

- Sweet potato needs watering
- 2 weeks to harvest for carrots
- Fill space X
- Weekly meeting

Try this in the phone:

1. Text as Emma: `from 8-9 I planted trees`. It asks am or pm instead of guessing. Reply `am`. The block lands on the north border, because trees are already there.
2. Text as Sonali: `from 8-9am I planted kale`, then `space x`. Space X leaves the priority list and a kale planting is created.
3. Text as Jeremy: `weeded the carrot row for an hour`, then `10am`.
4. Ask `what needs watering?` or `what's on the schedule this week?`
5. `undo` removes that person's latest log.
6. Choose **New**, text a chore, and give a name when asked. They show up on the calendar in their own color.
7. Attach a photo. It is stored with the session and served at `GET /api/photos` for the garden map.
8. Click Jeremy’s sweet-potato block. The session opens on the calendar.
9. Text `schedule kumquats from 4-5 today`. It asks am or pm, then which row, and does not read the week back.

**Reset demo** restores the sample week.

## Shared records

| Record | Fields |
| --- | --- |
| Person | `id`, `name`, `phone`, `color` |
| Bed | `id`, `name`, `row`, `geometry` (null until the map sets it) |
| Planting | `id`, `bed_id`, `crop`, `planted_date`, `expected_harvest_date`, `removed_date`, `season_year` |
| WorkSession | `id`, `person_id`, `start`, `end`, `activity_type`, `bed_id`, `planting_id`, `notes`, `raw_message` |
| Photo | `id`, `session_id`, `person_id`, `url`, `caption`, `taken_at` |
| Task | `id`, `type`, `severity`, `due_date`, `planting_id`, `bed_id` |

Read them without phone numbers:

- `GET /api/people`
- `GET /api/beds`
- `GET /api/plantings`
- `GET /api/sessions`
- `GET /api/photos` (adds `person_name`, `bed_id`, `planting_id`)
- `GET /api/tasks`
- `GET /api/crop-families`

These responses allow any origin, so the map can run on another port. A planting text creates or updates a planting as well as a work session. One bed can hold many plantings over time; old seasons stay in the collection with `removed_date` set.

Priority colors are rules, not a model:

- Red, watering: no watering log in the last 3 days
- Orange, harvest: expected harvest within 21 days
- Green, fill: a bed with no crop in the ground
- Green, meeting: Saturday 10:00am unless someone already logged it

## Texts

The on-screen phone is the channel that works with no keys. A real SMS line uses [Photon 2.0](https://photon.codes/docs/beta). Point a `message.received` webhook at `/api/photon`.

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

With `MONGODB_URI`, the same records live in MongoDB (`people`, `beds`, `plantings`, `workSessions`, `photos`, `tasks`). Photo files stay on disk under `public/uploads`; Mongo holds the URL. If Atlas is set but unreachable, the app falls back to the JSON file.

`GEMINI_API_KEY` is the only AI key. It runs the text agent, photo captions, and Import drawing's handwriting reading with `GEMINI_MODEL`. If that model is overloaded or slow (more than 4 seconds for a text, 40 for a drawing), `GEMINI_FALLBACK_MODEL` answers. All Gemini calls go through `src/lib/gemini.ts`. LangChain is not used for texts. Clock times and days written in the text win over the model's reading, and the model cannot invent a day. If no key is set or every call fails, the rules parser answers. Either way, a missing time of day or row gets one short question, and an injury or emergency gets a fixed reply to call 911 and is not logged.

Each incoming text gets one reply at most, with every line of the answer in that message. Replies are capped at `PHOTON_DAILY_LIMIT` per sender per day (100 by default). The last reply before the cap says so, and texts after it are still logged. The on-screen phone does not use Photon and has no cap. Phone numbers stay in the database and are not returned by the read APIs above.

## Not in this slice

The garden map, plant recommendations, and the weekly planner that assigns volunteers are separate. Crop families are available at `/api/crop-families` for that planner. Nothing here texts a volunteer unless they texted first, or a Photon webhook is delivering their own message.

## Garden view

Open [/garden](http://localhost:3000/garden), or use the Garden / Calendar tabs.

- The map is pixel art drawn to scale in feet over a faint 5 ft grid. The whole garden is one bed of soil (grass only outside an odd-shaped edge), and each bed is a patch of it with a faint dashed outline, filled with small drawings of its crop, about one per 2.5 ft. A patch's name shows when you hover or select it; the plant list names them all. Planned crops show faded, and open patches show bare soil. A water drop or harvest basket on a patch mirrors the priority list.
- Patches can't overlap. In Edit layout, dragging or resizing stops at the neighboring patch, "+ Add bed" puts the new one on open ground, and the server refuses a move that would overlap (`src/lib/bed-space.ts`).
- Crop drawings are 16×16 sprites in `src/lib/pixel-sprites.ts`. To use your own art, drop a PNG into `public/sprites/` named after the crop (`carrots.png`, `sweet-potato.png`) or a sprite group (`leafy.png`, `pod.png`). It replaces the built-in drawing everywhere. See `public/sprites/README.md`.
- Click a bed to see what's growing, when it was last watered and by whom, past seasons, recent work, and photos from texts.
- **Suggestions** come from fixed rules in `src/lib/recommend.ts` (no LLM). The rules are: don't repeat a family grown in this bed this season or last, follow a heavy feeder with a nitrogen fixer, and prefer crops whose sowing window is open once the bed is free. Sowing months, water, sun, and soil live in `src/data/crop-guide.json` and are set for a zone 6b/7a garden. Edit them for yours.
- **Add to plan** (or drag a suggestion card onto any bed) creates a planned planting dated to its sowing window. When someone later texts `planted garlic in space x`, the plan becomes the real planting. A bed with something planned drops off the "Fill" priority.
- **Edit layout** lets you drag beds to move them, drag the corner to resize, add, rename, or remove beds, set the garden's width and length, and set a town for the "Find seeds nearby" links.
- **Dropping a crop on a patch that already has one** goes by the date on the timeline. If the patch holds a single crop that hasn't been in the ground a full day (or is still a plan), the new crop replaces it without asking. Otherwise a box asks: **Replace** (tick which crops, if there are several), **Plant after**, or **Plant alongside**, each with the date it would go in. Replaced plans are deleted; anything already planted, or logged by text, is marked pulled on that date so rotation still remembers it (`src/lib/drop-plan.ts`).
- **Plans need confirming.** A crop planned in the garden view stays a plan, even after its date, until someone texts that they planted it (the text agent matches the crop and plot, early or late) or you click **Mark planted** in the bed panel. A late plan reads "not planted yet", stays faded on the map, and doesn't count as growing, so it doesn't trigger watering or harvest tasks. Plantings carry `status: "planned"` until confirmed; records without a status (texts, imports, older data) count as planted.
- **Plant list order:** empty plots first, then planted plots by harvest date (soonest or overdue on top), then plots that only have plans.
- **Plot names:** an imported drawing names its plots Plot 1, Plot 2, … (what's written in each box becomes its crops), and "+ Add bed" makes the next "Plot N". Double-click a plot on the map or its name in the plant list (or press F2 on a selected plot) to rename it; Enter saves, Escape cancels.
- **Several crops in one bed.** When a bed already has something growing or planned, each suggestion offers **Replace**, **Alongside** (shares the bed, from the date on the timeline or tomorrow, inside the crop's sowing window), or **After** (once the bed is free). Suggestions are ranked by the soonest a crop could go in, so a planted bed still shows what can go in now. Mixed beds show as a checkerboard of their crops. Dropping a crop on the map plants it after.
- **Zoom** with the − / + buttons above the map, Ctrl/⌘ + scroll, or a trackpad pinch (up to 400%). Plant drawings get bigger, not more numerous. The map scrolls inside its card; **Fit** shows the whole garden again, with a grass border so the garden fills about 80% of the map.
- **Removing a plant:** select a patch and press Delete (or Backspace); with several crops, a box asks which. In **Edit layout**, Delete removes the patch itself instead (same as **Remove bed**), along with any plans in it that haven't started; a patch with real planting history stays. Every crop in the bed panel also has **Remove**. Plans are deleted; anything already planted is marked pulled on the timeline date.
- **Timeline** above the map shows the garden on any date. The slider covers six months; ‹ and › beside it move three months at a time (taking the date with them), from two seasons back to five years ahead. Drag the slider, step a month at a time, or click a month name. Dots on the bar are plantings (filled) and plans (hollow); the red line is today. Looking back is view only and shows what was in each bed that day. Looking ahead, crops nobody has marked removed are assumed cleared two weeks after their expected harvest, so beds open up; drop a crop on a bed to plan it for that date, with rotation checked against that year. `/garden?day=2027-05-01` opens on a date. Bed shapes aren't dated, so past dates use today's layout.
- **Import drawing** builds the garden from a hand-drawn plan. Draw each bed as a closed box (or a solid block of color) on plain paper, draw a box around the whole garden for scale, write names or crops inside, and photograph it. The browser finds the boxes itself (`src/lib/sketch-detect.ts`, no AI): it uses the outer box as the garden's edge and splits L-shaped beds into two rectangles. If `GEMINI_API_KEY` is set, Gemini reads the handwriting to fill in names, crops, and the garden size (`src/lib/sketch-labels.ts`). Without a key, you type the names. You review everything before it's saved. A drawn bed with the same name as an existing one moves that bed and keeps its history. "Replace" never deletes a bed that has planting history. There's a sample drawing in `public/sample-garden-drawing.png`. PDFs work too: the first page is drawn as an image in the browser (PDF.js, `src/lib/pdf-page.ts`) and goes through the same steps; a note says which page was used if there are several.
  - It also handles real plans: odd-shaped or curved garden edges (the map draws that shape), beds that the edge line cuts through, dozens of thin labeled beds, beds with several crops ("Kale / Peas" shows both, alternating), and sizes in meters written along the edges. Gemini is told which lettered side each "7 m" belongs to, and the scale comes from the median of all of them.
  - Detection tries a few line sensitivities and keeps the one that finds the most beds. The slider overrides it. Any labeled bed it still misses, Gemini adds as a dashed box for you to check.
  - "Replace" archives old beds that have planting history (off the map, history kept) instead of deleting them.
  - The map can show meters: Edit layout → units. Sizes are stored in feet either way.
- **Ideas from Gemini** in a bed's panel: press **Ask Gemini** and it suggests four crops for the date on the timeline, picked for the month and season near your town (set **Near** in Edit layout), and for how they get on with what's in and next to the bed. The server drops anything from a family rotation rules out there; crops the app doesn't know are marked "new to this app". The date on each card comes from the app's crop guide, which is what gets planned. It only asks when you press the button (answers are kept per bed and date until you reload), to save the daily quota (`src/lib/bed-ideas.ts`, `POST /api/beds/:id/ideas`).

Demo: click **Space X**. Tomatoes grew there in 2025, so nightshades are skipped. Garlic and winter rye can go in now (November), and clover is suggested to put nitrogen back. Click **Add to plan** on garlic, then text as Sonali `from 9-10am I planted garlic in space x`.

New endpoints: `POST /api/layout/sketch` (read a drawing's labels), `POST /api/beds/import` (build beds from a drawing), `GET /api/garden`, `GET|PUT /api/layout`, `POST /api/beds`, `PATCH|DELETE /api/beds/:id`, `POST /api/plantings`, `DELETE /api/plantings/:id` (planned only).
