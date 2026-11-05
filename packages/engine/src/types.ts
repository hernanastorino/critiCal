/** All instants are epoch milliseconds; all durations are minutes. */

export const MINUTE = 60_000;
export const DAY_MINUTES = 1440;

export interface Interval {
  start: number;
  end: number;
}

/** Minutes since local midnight. Values ≥ 1440 mean "after midnight, next day". */
export interface MinuteRange {
  start: number;
  end: number;
}

export interface DaySettings {
  /** Usual wake-up time. */
  wake: number;
  /** Minutes after waking that are never planned (breakfast, getting ready, commute). */
  morningMinutes?: number;
  /** Usual bedtime; ≤ wake means after midnight. */
  bed: number;
  meals: MinuteRange[];
  /** From this minute on, academic work is free time (soft limit). */
  freeFrom: number;
}

export interface Settings {
  timezone: string;
  /** Indexed by weekday, 0 = Sunday. */
  week: DaySettings[];
  slotMinutes: number;
  travelMarginMinutes: number;
  /** Soft cap of distinct activities in one day. */
  maxActivitiesPerDay: number;
  /** Below this slack (minutes) a task is shown as yellow. */
  warnSlackMinutes: number;
}

export interface DayOverride {
  /** Local date, YYYY-MM-DD. */
  date: string;
  wake?: number;
  bed?: number;
  /** Plan the day with this weekday's routine (a holiday as a Sunday). */
  asWeekday?: number;
}

export interface Activity {
  id: string;
  name: string;
  color: string;
  /** Academic activities may not use free time unless allowed. */
  academic: boolean;
  maxSessionMinutes: number;
  minBlockMinutes: number;
  preferred?: MinuteRange;
  /**
   * What it is for the app (the planner ignores it): a subject taken this semester, or
   * a routine like the gym. Unset for activities from before the distinction.
   */
  kind?: "materia" | "rutina";
  /** Other names a materia goes by in events, normalized ("add"). */
  aliases?: string[];
  /** Study minutes before each break (the app's default for materias: 50). */
  studyMinutes?: number;
  /** Rest after each study stretch, inside the block's time (default for materias: 10). */
  breakMinutes?: number;
}

export interface Task {
  id: string;
  activityId: string;
  title: string;
  deadline: number;
  /** Target minutes still to do. */
  remainingMinutes: number;
  /** Minutes that must be done no matter what. */
  minRemainingMinutes: number;
  earliestStart?: number;
  /** Fixed session length (habits like gym). */
  sessionMinutes?: number;
  /** At most this many minutes of the task per day. */
  maxPerDayMinutes?: number;
  /** Higher survives cuts longer. */
  priority: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  location?: string;
  /** "Show as busy"; free events can overlap planned blocks. */
  busy: boolean;
  allDay?: boolean;
}

export type Level = "ok" | "warn" | "critical";

export interface PlanBlock {
  id: string;
  taskId: string;
  activityId: string;
  start: number;
  end: number;
  frozen?: boolean;
  /** Placed inside free time. */
  soft?: boolean;
  level?: Level;
}

export interface TaskStatus {
  taskId: string;
  scheduledMinutes: number;
  /** Minimum minutes that could not be placed. */
  minDeficit: number;
  /** Target minutes that could not be placed. */
  targetDeficit: number;
  slack: number;
  level: Level;
}
