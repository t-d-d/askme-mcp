// Hours are applied here, not by the model, on the wall clock of the time
// zone the rules were saved in, so they follow the clocks when they change.
import {
  endOfDay,
  weekdays,
  type Hashtag,
  type TimeWindow,
  type Weekday,
} from "../../shared/page-api";

// minute counts from 0 at midnight.
export interface WallClock {
  day: Weekday;
  minute: number;
}

export const minutesInDay = 24 * 60;

export function wallClock(
  at: number,
  timeZone?: string,
): WallClock | undefined {
  let parts: Intl.DateTimeFormatPart[];
  try {
    // Made for each reading, so a change to this browser's own time zone is
    // seen at once.
    parts = new Intl.DateTimeFormat("en-US", {
      ...(timeZone === undefined ? {} : { timeZone }),
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
  } catch {
    // A RangeError: no zone has that name.
    return undefined;
  }
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((one) => one.type === type)?.value ?? "";
  const day = weekdays.find((one) => one === part("weekday").toLowerCase());
  const hour = part("hour");
  const minutes = part("minute");
  // Some browsers write the first hour after midnight as 24.
  const minute = (Number(hour) * 60 + Number(minutes)) % minutesInDay;
  if (
    day === undefined ||
    hour === "" ||
    minutes === "" ||
    !Number.isInteger(minute)
  ) {
    return undefined;
  }
  return { day, minute };
}

// "24:00", the end of the day, gives minutesInDay.
const minuteOf = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const dayBefore = (day: Weekday): Weekday =>
  weekdays[(weekdays.indexOf(day) + weekdays.length - 1) % weekdays.length] ??
  day;

// from is inclusive and to exclusive. A window that closes before it opens
// runs past midnight, from the days it opens on.
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

export function isOpen(
  windows: readonly TimeWindow[],
  clock: WallClock,
): boolean {
  return windows.length === 0 || windows.some((one) => windowOpen(one, clock));
}

// A restriction wins (PRD, "Decisions and reasons"). An unknown time zone
// holds nothing, so no ask is hidden by mistake.
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

function timeText(time: string): string {
  const minute = minuteOf(time);
  if (minute === 0 || minute === minutesInDay) return "midnight";
  const hour = Math.floor(minute / 60);
  const past = minute % 60;
  const onDial = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = past === 0 ? "" : `:${String(past).padStart(2, "0")}`;
  return `${String(onDial)}${minutes}${hour < 12 ? "am" : "pm"}`;
}

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
