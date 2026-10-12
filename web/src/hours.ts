// A hashtag's hours, applied in code (PRD, "Back end"): which asks are held
// back at a moment, and how the hours read on the rules screen. The model
// only reads the windows from the rules. Whether one is open is worked out
// here, from the wall clock in the time zone the rules were saved in, so it
// follows the clocks when they change.
import {
  endOfDay,
  weekdays,
  type Hashtag,
  type TimeWindow,
  type Weekday,
} from "../../shared/page-api";

// A moment as a clock on the wall shows it in one time zone: the day of the
// week, and the minute of the day, from 0 at midnight.
export interface WallClock {
  day: Weekday;
  minute: number;
}

const minutesInDay = 24 * 60;

// One reader of the wall clock for each time zone, made when first needed.
const readers = new Map<string, Intl.DateTimeFormat>();

function readerFor(timeZone: string | undefined): Intl.DateTimeFormat {
  const key = timeZone ?? "";
  const known = readers.get(key);
  if (known !== undefined) return known;
  const reader = new Intl.DateTimeFormat("en-US", {
    ...(timeZone === undefined ? {} : { timeZone }),
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  readers.set(key, reader);
  return reader;
}

// The wall clock at a moment, in a time zone or, without one, in this
// browser's. Undefined in a time zone this browser does not know.
export function wallClock(
  at: number,
  timeZone?: string,
): WallClock | undefined {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = readerFor(timeZone).formatToParts(at);
  } catch {
    // A RangeError: no zone has that name.
    return undefined;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? "";
  const day = weekdays.find((one) => one === part("weekday").toLowerCase());
  const minute = Number(part("hour")) * 60 + Number(part("minute"));
  if (day === undefined || !Number.isInteger(minute)) return undefined;
  return { day, minute };
}

// The minute of the day a time on the 24-hour clock names, with 24:00 the
// end of the day.
const minuteOf = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// The day before, as a window that runs past midnight opened on it.
const dayBefore = (day: Weekday): Weekday =>
  weekdays[(weekdays.indexOf(day) + weekdays.length - 1) % weekdays.length] ??
  day;

// Whether one window is open on the wall clock. It opens on its first
// minute and closes on its last, and one that closes before it opens runs
// past midnight, from the days it opens on.
function windowOpen({ days, from, to }: TimeWindow, clock: WallClock): boolean {
  const opens = minuteOf(from);
  const closes = minuteOf(to);
  if (opens < closes) {
    return (
      days.includes(clock.day) && clock.minute >= opens && clock.minute < closes
    );
  }
  return (
    (days.includes(clock.day) && clock.minute >= opens) ||
    (days.includes(dayBefore(clock.day)) && clock.minute < closes)
  );
}

// Whether a hashtag's hours are open on the wall clock: when any of its
// windows is, or always when it has none.
export function isOpen(
  windows: readonly TimeWindow[],
  clock: WallClock,
): boolean {
  return windows.length === 0 || windows.some((one) => windowOpen(one, clock));
}

// The ids of the asks held back at a moment: each sorted into a hashtag
// whose hours are closed then. A restriction wins, so one closed hashtag
// holds an ask whatever its others say (PRD, "Decisions and reasons"). An
// ask not sorted yet has no hashtag to hold it, and nor does one whose
// hashtag has left the rules. Where the time zone is not one this browser
// knows, nothing is held, so no ask is hidden by mistake.
export function heldAsks(
  asks: readonly {
    id: string;
    sort: { hashtags: readonly string[] } | null;
  }[],
  hashtags: readonly Hashtag[],
  timeZone: string | undefined,
  at: number,
): ReadonlySet<string> {
  const clock = wallClock(at, timeZone);
  if (clock === undefined) return new Set();
  const closed = new Set(
    hashtags
      .filter(({ hours }) => hours !== undefined && !isOpen(hours, clock))
      .map(({ name }) => name),
  );
  return new Set(
    asks
      .filter(({ sort }) => sort?.hashtags.some((name) => closed.has(name)))
      .map(({ id }) => id),
  );
}

const dayNames: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

const listed = (words: readonly string[]) =>
  words.length <= 1
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1) ?? ""}`;

// The days a window opens on, in words: "Every day", "Weekdays",
// "Weekends", a run of three or more as "Monday to Thursday", and any other
// days one by one, as "Tuesdays and Thursdays".
function daysText(days: readonly Weekday[]): string {
  const inOrder = weekdays.filter((day) => days.includes(day));
  const named = inOrder.join(" ");
  if (named === weekdays.join(" ")) return "Every day";
  if (named === "mon tue wed thu fri") return "Weekdays";
  if (named === "sat sun") return "Weekends";
  const first = inOrder[0];
  const last = inOrder.at(-1);
  const run =
    first !== undefined &&
    last !== undefined &&
    weekdays.indexOf(last) - weekdays.indexOf(first) === inOrder.length - 1;
  if (run && inOrder.length >= 3) {
    return `${dayNames[first]} to ${dayNames[last]}`;
  }
  return listed(inOrder.map((day) => `${dayNames[day]}s`));
}

// A time on the 24-hour clock as the rules screen writes it: "8am",
// "5:30pm", or "midnight" at either end of the day.
function timeText(time: string): string {
  const minute = minuteOf(time);
  if (minute === 0 || minute === minutesInDay) return "midnight";
  const hour = Math.floor(minute / 60);
  const past = minute % 60;
  const onDial = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = past === 0 ? "" : `:${String(past).padStart(2, "0")}`;
  return `${String(onDial)}${minutes}${hour < 12 ? "am" : "pm"}`;
}

// A hashtag's hours as the rules screen shows them: one line for each
// window, or "Any time" when it has none (docs/design.md, "Rules").
export function hoursText(windows: readonly TimeWindow[]): string[] {
  if (windows.length === 0) return ["Any time"];
  return windows.map(({ days, from, to }) => {
    const hours =
      from === "00:00" && to === endOfDay
        ? "all day"
        : `${timeText(from)} to ${timeText(to)}`;
    return `${daysText(days)}, ${hours}`;
  });
}
