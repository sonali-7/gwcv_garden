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
  weekday: number | null;
  nextWeek: boolean;
  start: { h: number; m: number } | null;
  end: { h: number; m: number } | null;
  startAmpm: "am" | "pm" | null;
  endAmpm: "am" | "pm" | null;
  durationMin: number | null;
  onDate: string | null;
  place: string | null;
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

export type Conversation = {
  pending: Pending | null;
  lastSessionId: string | null;
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
