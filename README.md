# Garden log

The people side of the community garden app: a weekly calendar of who did the work, a priority list, and a text thread that writes both.

The garden map and plant list belong to the other half of the project. This app exposes the shared records those views can read.

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
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5
PHOTON_API_KEY=
PHOTON_PROJECT_ID=
PHOTON_WEBHOOK_SECRET=
GARDEN_TZ=America/New_York
```

With `MONGODB_URI`, the same records live in MongoDB (`people`, `beds`, `plantings`, `workSessions`, `photos`, `tasks`). Photo files stay on disk under `public/uploads`; Mongo holds the URL. If Atlas is set but unreachable, the app falls back to the JSON file.

`GEMINI_API_KEY` runs the text agent and photo captions with `GEMINI_MODEL`. If that model is overloaded or takes more than 4 seconds, `GEMINI_FALLBACK_MODEL` answers. With only `ANTHROPIC_API_KEY`, Claude does the same job. LangChain is not used for texts. Clock times and days written in the text win over the model's reading, and the model cannot invent a day. If no key is set or every call fails, the rules parser answers. Either way, a missing time of day or row gets one short question, and an injury or emergency gets a fixed reply to call 911 and is not logged.

Each incoming text gets one reply at most, with every line of the answer in that message. Replies are capped at `PHOTON_DAILY_LIMIT` per sender per day (100 by default). The last reply before the cap says so, and texts after it are still logged. The on-screen phone does not use Photon and has no cap. Phone numbers stay in the database and are not returned by the read APIs above.

## Not in this slice

The garden map, plant recommendations, and the weekly planner that assigns volunteers are separate. Crop families are available at `/api/crop-families` for that planner. Nothing here texts a volunteer unless they texted first, or a Photon webhook is delivering their own message.
