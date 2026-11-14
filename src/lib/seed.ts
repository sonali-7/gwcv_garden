import { randomUUID } from "node:crypto";
import { buildTasks } from "./priority";
import { sentence, workPhrase } from "./phrases";
import { addDays, DEFAULT_TZ, startOfWeekYmd, todayYmd, whenPhrase, zonedToUtc } from "./time";
import { defaultLayout, type Bed, type DatabaseShape, type Person, type Planting, type ThreadMessage, type WorkSession } from "./types";

export function buildSeed(now: Date, timeZone = DEFAULT_TZ): DatabaseShape {
  const today = todayYmd(now, timeZone);
  const week = startOfWeekYmd(now, timeZone);
  const monday = addDays(week, 1);
  const tuesday = addDays(week, 2);
  const wednesday = addDays(week, 3);
  const thursday = addDays(week, 4);
  const yesterday = addDays(today, -1);

  const people: Person[] = [
    { id: "person-emma", name: "Emma", phone: "+15555501001", color: "#3e6fd8", timezone: timeZone },
    { id: "person-sonali", name: "Sonali", phone: "+15555501002", color: "#8a63c4", timezone: timeZone },
    { id: "person-jeremy", name: "Jeremy", phone: "+15555501003", color: "#d4533c", timezone: timeZone },
  ];

  const beds: Bed[] = [
    { id: "bed-sp", name: "Sweet potato row", row: "south", geometry: { x: 12, y: 10, w: 25, h: 5 } },
    { id: "bed-carrot", name: "Carrot row", row: "east", geometry: { x: 2, y: 10, w: 8, h: 8 } },
    { id: "bed-cabbage", name: "Cabbage row", row: "west", geometry: { x: 2, y: 20, w: 8, h: 8 } },
    { id: "bed-x", name: "Space X", row: "center", geometry: { x: 12, y: 17, w: 12, h: 11 } },
    { id: "bed-north", name: "North border", row: "north", geometry: { x: 2, y: 1.5, w: 36, h: 6 } },
  ];

  const plantings: Planting[] = [
    planting("planting-sp", "bed-sp", "sweet potato", addDays(today, -80), 120, null),
    planting("planting-carrots", "bed-carrot", "carrots", addDays(today, -56), 70, null),
    planting("planting-cabbage", "bed-cabbage", "cabbage", addDays(today, -40), 80, null),
    planting("planting-trees", "bed-north", "trees", addDays(today, -20), 365, null),
    planting("planting-2024-sp", "bed-sp", "tomatoes", "2024-05-01", 80, "2024-10-01"),
    planting("planting-2025-sp", "bed-sp", "sweet potato", "2025-05-10", 120, "2025-10-15"),
    planting("planting-2024-carrot", "bed-carrot", "beans", "2024-04-01", 60, "2024-07-01"),
    planting("planting-2025-carrot", "bed-carrot", "lettuce", "2025-04-15", 45, "2025-06-20"),
    planting("planting-2024-cabbage", "bed-cabbage", "corn", "2024-05-20", 80, "2024-09-01"),
    planting("planting-2025-cabbage", "bed-cabbage", "peas", "2025-04-01", 60, "2025-06-15"),
    planting("planting-2024-x", "bed-x", "beans", "2024-05-15", 60, "2024-08-01"),
    planting("planting-2025-x", "bed-x", "tomatoes", "2025-05-20", 80, "2025-09-25"),
  ];

  const sessions: WorkSession[] = [
    session({
      id: "session-emma-trees",
      personId: "person-emma",
      day: monday,
      startHour: 8,
      endHour: 9,
      activity: "plant",
      bedId: "bed-north",
      plantingId: "planting-trees",
      crop: "trees",
      bedName: "North border",
      raw: "from 8-9am I planted trees on the north border",
      timeZone,
    }),
    session({
      id: "session-sonali-weed",
      personId: "person-sonali",
      day: tuesday,
      startHour: 10,
      endHour: 12,
      activity: "weed",
      bedId: "bed-cabbage",
      plantingId: "planting-cabbage",
      crop: "cabbage",
      bedName: "Cabbage row",
      raw: "weeded the cabbage row from 10am to 12pm",
      timeZone,
    }),
    session({
      id: "session-jeremy-walk",
      personId: "person-jeremy",
      day: wednesday,
      startHour: 10,
      endHour: 11,
      activity: "other",
      bedId: null,
      plantingId: null,
      crop: null,
      bedName: null,
      raw: "walked the rows from 10-11am",
      notes: "Walked the rows and sharpened tools.",
      timeZone,
    }),
    session({
      id: "session-jeremy-weed",
      personId: "person-jeremy",
      day: thursday,
      startHour: 8,
      endHour: 13,
      activity: "weed",
      bedId: "bed-sp",
      plantingId: "planting-sp",
      crop: "sweet potato",
      bedName: "Sweet potato row",
      raw: "weeded the sweet potato row from 8am to 1pm",
      timeZone,
    }),
    session({
      id: "session-water-trees",
      personId: "person-sonali",
      day: yesterday,
      startHour: 7,
      startMinute: 0,
      endHour: 7,
      endMinute: 40,
      activity: "water",
      bedId: "bed-north",
      plantingId: "planting-trees",
      crop: "trees",
      bedName: "North border",
      raw: "watered the north border",
      timeZone,
    }),
    session({
      id: "session-water-cabbage",
      personId: "person-sonali",
      day: yesterday,
      startHour: 7,
      startMinute: 40,
      endHour: 8,
      endMinute: 20,
      activity: "water",
      bedId: "bed-cabbage",
      plantingId: "planting-cabbage",
      crop: "cabbage",
      bedName: "Cabbage row",
      raw: "watered the cabbage row",
      timeZone,
    }),
    session({
      id: "session-water-carrots",
      personId: "person-sonali",
      day: yesterday,
      startHour: 8,
      startMinute: 20,
      endHour: 9,
      endMinute: 0,
      activity: "water",
      bedId: "bed-carrot",
      plantingId: "planting-carrots",
      crop: "carrots",
      bedName: "Carrot row",
      raw: "watered the carrot row",
      timeZone,
    }),
    session({
      id: "session-water-sp",
      personId: "person-emma",
      day: addDays(today, -8),
      startHour: 9,
      endHour: 10,
      activity: "water",
      bedId: "bed-sp",
      plantingId: "planting-sp",
      crop: "sweet potato",
      bedName: "Sweet potato row",
      raw: "watered the sweet potato row from 9-10am",
      timeZone,
    }),
    session({
      id: "session-meeting",
      personId: "person-emma",
      day: addDays(today, -12),
      startHour: 10,
      endHour: 11,
      activity: "meeting",
      bedId: null,
      plantingId: null,
      crop: null,
      bedName: null,
      raw: "weekly meeting from 10-11am",
      timeZone,
    }),
    session({
      id: "session-compost",
      personId: "person-jeremy",
      day: addDays(today, -10),
      startHour: 15,
      endHour: 16,
      activity: "other",
      bedId: null,
      plantingId: null,
      crop: null,
      bedName: null,
      raw: "hauled compost from 3-4pm",
      notes: "Hauled compost to the paths.",
      timeZone,
    }),
  ];

  const treeSession = sessions[0];
  const weedSession = sessions[3];
  const photos = [
    {
      id: "photo-trees",
      session_id: treeSession.id,
      person_id: "person-emma",
      url: "/photos/trees.svg",
      caption: "Young trees along the north border.",
      taken_at: treeSession.start,
    },
    {
      id: "photo-weeds",
      session_id: weedSession.id,
      person_id: "person-jeremy",
      url: "/photos/weeds.svg",
      caption: "Weeds pulled from the sweet potato row.",
      taken_at: weedSession.start,
    },
  ];

  const threads: Record<string, ThreadMessage[]> = {
    "+15555501001": [
      bubble("in", treeSession.raw_message, treeSession.start),
      bubble("out", "Got it.", treeSession.start),
      bubble(
        "out",
        `Logged: Emma, ${whenPhrase(new Date(treeSession.start), new Date(treeSession.end), now, timeZone)}, ${workPhrase("plant", "trees", "North border")}.`,
        treeSession.start,
      ),
    ],
    "+15555501002": [
      bubble("in", sessions[1].raw_message, sessions[1].start),
      bubble(
        "out",
        `Logged: Sonali, ${whenPhrase(new Date(sessions[1].start), new Date(sessions[1].end), now, timeZone)}, ${workPhrase("weed", "cabbage", "Cabbage row")}.`,
        sessions[1].start,
      ),
    ],
    "+15555501003": [
      bubble("in", sessions[3].raw_message, sessions[3].start, "/photos/weeds.svg"),
      bubble(
        "out",
        `Logged: Jeremy, ${whenPhrase(new Date(sessions[3].start), new Date(sessions[3].end), now, timeZone)}, ${workPhrase("weed", "sweet potato", "Sweet potato row")}.`,
        sessions[3].start,
      ),
    ],
  };

  const tasks = buildTasks({ now, beds, plantings, sessions, timeZone });

  return {
    people,
    beds,
    plantings,
    sessions,
    photos,
    tasks,
    threads,
    conversations: {},
    demoPhones: [],
    seenEvents: [],
    layout: defaultLayout(),
  };
}

function planting(
  id: string,
  bedId: string,
  crop: string,
  planted: string,
  days: number,
  removed: string | null,
): Planting {
  return {
    id,
    bed_id: bedId,
    crop,
    planted_date: planted,
    expected_harvest_date: addDays(planted, days),
    removed_date: removed,
    season_year: Number(planted.slice(0, 4)),
    days_to_maturity: days,
    source_session_id: null,
  };
}

function session(input: {
  id: string;
  personId: string;
  day: string;
  startHour: number;
  startMinute?: number;
  endHour: number;
  endMinute?: number;
  activity: WorkSession["activity_type"];
  bedId: string | null;
  plantingId: string | null;
  crop: string | null;
  bedName: string | null;
  raw: string;
  notes?: string;
  timeZone: string;
}): WorkSession {
  const phrase = workPhrase(input.activity, input.crop, input.bedName);
  return {
    id: input.id,
    person_id: input.personId,
    start: zonedToUtc(input.day, input.startHour, input.startMinute ?? 0, input.timeZone).toISOString(),
    end: zonedToUtc(input.day, input.endHour, input.endMinute ?? 0, input.timeZone).toISOString(),
    activity_type: input.activity,
    bed_id: input.bedId,
    planting_id: input.plantingId,
    notes: input.notes ?? `${sentence(phrase)}.`,
    raw_message: input.raw,
  };
}

function bubble(direction: "in" | "out", text: string, at: string, imageUrl: string | null = null): ThreadMessage {
  return { id: randomUUID(), direction, text, at, imageUrl };
}
