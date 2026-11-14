export type ActivityType =
  | "plant"
  | "water"
  | "weed"
  | "harvest"
  | "prep"
  | "meeting"
  | "other";

export type TaskSeverity = "urgent" | "upcoming" | "routine";

export type Person = {
  id: string;
  name: string;
  phone: string;
  color: string;
  timezone: string;
};

export type PublicPerson = {
  id: string;
  name: string;
  color: string;
  timezone: string;
};

export type Bed = {
  id: string;
  name: string;
  row: string;
  geometry: { x: number; y: number; w: number; h: number } | null;
  /** Off the map (replaced by an imported drawing). Its planting history is kept. */
  archived?: boolean;
};

export type GardenLayout = {
  /** Sizes are always stored in feet; units only changes how they're shown. */
  widthFt: number;
  lengthFt: number;
  imageUrl: string | null;
  location: string;
  units: "ft" | "m";
  /** The garden's shape as [x, y] points in feet, when it isn't a plain rectangle. */
  outline: Array<[number, number]> | null;
};

export function defaultLayout(): GardenLayout {
  return { widthFt: 40, lengthFt: 30, imageUrl: null, location: "", units: "ft", outline: null };
}

export type Planting = {
  id: string;
  bed_id: string;
  crop: string;
  planted_date: string;
  expected_harvest_date: string;
  removed_date: string | null;
  season_year: number;
  days_to_maturity: number;
  source_session_id: string | null;
};

export type WorkSession = {
  id: string;
  person_id: string;
  start: string;
  end: string;
  activity_type: ActivityType;
  bed_id: string | null;
  planting_id: string | null;
  notes: string;
  raw_message: string;
};

export type Photo = {
  id: string;
  session_id: string | null;
  person_id: string;
  url: string;
  caption: string;
  taken_at: string;
};

export type Task = {
  id: string;
  type: "water" | "harvest" | "fill" | "meeting";
  severity: TaskSeverity;
  title: string;
  detail: string;
  due_date: string;
  planting_id: string | null;
  bed_id: string | null;
  status: "open" | "proposed" | "approved";
};

export type ThreadMessage = {
  id: string;
  direction: "in" | "out";
  text: string;
  at: string;
  imageUrl: string | null;
};

export type SessionDraft = {
  activity: ActivityType | null;
  crop: string | null;
  dayOffset: number | null;
  /** First / primary weekday (0=Sun). Prefer `weekdays` when several are named. */
  weekday: number | null;
  /** Every weekday named in the text, e.g. Tuesday and Thursday. */
  weekdays: number[];
  nextWeek: boolean;
  /** How many weeks to place (1 = once; 8 = standing weekly for a couple months). */
  recurringWeeks: number;
  start: { h: number; m: number } | null;
  end: { h: number; m: number } | null;
  startAmpm: "am" | "pm" | null;
  endAmpm: "am" | "pm" | null;
  durationMin: number | null;
  onDate: string | null;
  place: string | null;
  /** Every bed/row named in one text (Plot 8 and Plot 9). */
  places?: string[];
  sourceText: string;
};

export type HeldImage = {
  url: string;
  caption: string;
};

export type Pending =
  | { kind: "name"; resumeText: string; image: HeldImage | null }
  | {
      kind: "time";
      field: "start" | "ampm" | "end" | "day";
      draft: SessionDraft;
      image: HeldImage | null;
      tries: number;
    }
  | { kind: "row"; draft: SessionDraft; image: HeldImage | null; tries: number; choices: string[] };

/** Short rolling context so follow-ups like "also … at the same time" can reuse the last log. */
export type TextMemory = {
  at: string;
  activity: ActivityType;
  bedNames: string[];
  summary: string;
  start: { h: number; m: number } | null;
  end: { h: number; m: number } | null;
  startAmpm: "am" | "pm" | null;
  endAmpm: "am" | "pm" | null;
  durationMin: number | null;
  dayOffset: number | null;
};

export type Conversation = {
  pending: Pending | null;
  lastSessionId: string | null;
  /** Whole batch from the last multi-day / standing log (undo removes all of these). */
  lastSessionIds?: string[];
  memory?: TextMemory | null;
  photon: { spaceId: string; agentId: string } | null;
  sentToday: { day: string; count: number } | null;
};

export type DatabaseShape = {
  people: Person[];
  beds: Bed[];
  plantings: Planting[];
  sessions: WorkSession[];
  photos: Photo[];
  tasks: Task[];
  threads: Record<string, ThreadMessage[]>;
  conversations: Record<string, Conversation>;
  demoPhones: string[];
  seenEvents: string[];
  layout?: GardenLayout;
};

export type DashboardData = {
  weekStart: string;
  today: string;
  timezone: string;
  people: PublicPerson[];
  beds: Bed[];
  plantings: Planting[];
  sessions: WorkSession[];
  tasks: Task[];
  photos: Photo[];
  threads: Record<string, ThreadMessage[]>;
  newSender: {
    available: boolean;
    thread: ThreadMessage[];
  };
};

export function toPublicPerson(person: Person): PublicPerson {
  return {
    id: person.id,
    name: person.name,
    color: person.color,
    timezone: person.timezone,
  };
}

export function blankConversation(): Conversation {
  return {
    pending: null,
    lastSessionId: null,
    lastSessionIds: [],
    memory: null,
    photon: null,
    sentToday: null,
  };
}

export function emptyDatabase(): DatabaseShape {
  return {
    people: [],
    beds: [],
    plantings: [],
    sessions: [],
    photos: [],
    tasks: [],
    threads: {},
    conversations: {},
    demoPhones: [],
    seenEvents: [],
    layout: defaultLayout(),
  };
}
