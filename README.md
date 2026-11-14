# Garden log

The people side of the community garden app: a weekly calendar of who did the work, a priority list, and a text thread that writes both.

The garden map and plant list belong to the other half of the project. This app exposes the shared records those views can read.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No database or API key is required. Messages are parsed with rules and stored in `data/store.json`.

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
8. Click Jeremy’s sweet-potato block to read what he did.

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
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5
PHOTON_API_KEY=
PHOTON_PROJECT_ID=
PHOTON_WEBHOOK_SECRET=
GARDEN_TZ=America/New_York
```

With `MONGODB_URI`, the same records live in MongoDB (`people`, `beds`, `plantings`, `workSessions`, `photos`, `tasks`). Photo files stay on disk under `public/uploads`; Mongo holds the URL. If Atlas is set but unreachable, the app falls back to the JSON file.

`ANTHROPIC_API_KEY` is optional and only used to caption photos. The text parser does not call a model, so a volunteer still gets one short question when the time of day or the row is missing. Injury or emergency messages get a fixed reply to call 911 and are not logged.

Photon replies are capped at 12 texts per sender per day. Phone numbers stay in the database and are not returned by the read APIs above.

## Not in this slice

The garden map, plant recommendations, and the weekly planner that assigns volunteers are separate. Crop families are available at `/api/crop-families` for that planner. Nothing here texts a volunteer unless they texted first, or a Photon webhook is delivering their own message.
