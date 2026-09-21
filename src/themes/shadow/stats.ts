import type { Activity } from '@/types';

export interface ShadowSummary {
  totalDistanceMeters: number;
  totalCount: number;
  yearDistanceMeters: number;
  yearCount: number;
  activeDays: number;
  streakDays: number;
  streakLabel: '当前连续' | '该年最长连续';
}

export interface HeatmapDay {
  date: string;
  activityCount: number;
  distanceMeters: number;
  intensity: number;
  future: boolean;
}

export interface HeatmapGrid {
  weeks: HeatmapDay[][];
  monthLabels: { label: string; week: number }[];
  maxDistanceMeters: number;
}

export interface MonthDistance {
  month: number;
  distanceMeters: number;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function todayKey(today: Date): string {
  return dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function activityDateKey(activity: Activity): string {
  return activity.start_date_local.slice(0, 10);
}

export function activityYear(activity: Activity): number {
  return Number(activityDateKey(activity).slice(0, 4));
}

export function activityTypes(activities: Activity[]): string[] {
  return Array.from(new Set(activities.map((activity) => activity.type))).sort(
    (a, b) => a.localeCompare(b)
  );
}

export function latestActivityYear(
  activities: Activity[],
  fallback = new Date().getFullYear()
): number {
  if (!activities.length) return fallback;
  return Math.max(...activities.map(activityYear));
}

export function filterActivities(
  activities: Activity[],
  sport: string,
  year?: number | null
): Activity[] {
  return activities.filter((activity) => {
    if (sport !== 'all' && activity.type !== sport) return false;
    return year == null || activityYear(activity) === year;
  });
}

export function latestActivityWithRoute(
  activities: Activity[],
  sport = 'all',
  year?: number | null
): Activity | null {
  return (
    filterActivities(activities, sport, year)
      .filter((activity) => Boolean(activity.summary_polyline))
      .sort(
        (a, b) =>
          b.start_date_local.localeCompare(a.start_date_local) ||
          b.run_id - a.run_id
      )[0] ?? null
  );
}

export function calculateStreak(
  activities: Activity[],
  sport: string,
  year: number,
  today = new Date()
): { days: number; label: '当前连续' | '该年最长连续' } {
  const currentYear = today.getFullYear() === year;
  const dates = Array.from(
    new Set(
      (currentYear
        ? filterActivities(activities, sport)
        : filterActivities(activities, sport, year)
      ).map(activityDateKey)
    )
  ).sort();
  const longest = longestDateStreak(dates);
  if (!currentYear) return { days: longest, label: '该年最长连续' };

  const todayDate = todayKey(today);
  const yesterdayDate = todayKey(addDays(today, -1));
  const latest = dates.at(-1);
  if (latest !== todayDate && latest !== yesterdayDate) {
    return { days: 0, label: '当前连续' };
  }

  const dateSet = new Set(dates);
  let days = 0;
  let cursor = new Date(`${latest}T12:00:00`);
  while (dateSet.has(todayKey(cursor))) {
    days += 1;
    cursor = addDays(cursor, -1);
  }
  return { days, label: '当前连续' };
}

function longestDateStreak(dates: string[]): number {
  if (!dates.length) return 0;
  let longest = 1;
  let current = 1;
  for (let index = 1; index < dates.length; index += 1) {
    const previous = new Date(`${dates[index - 1]}T12:00:00`);
    const next = new Date(`${dates[index]}T12:00:00`);
    const dayGap = Math.round((next.getTime() - previous.getTime()) / 86400000);
    current = dayGap === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

export function summarizeActivities(
  activities: Activity[],
  sport: string,
  year: number,
  today = new Date()
): ShadowSummary {
  const all = filterActivities(activities, sport);
  const yearly = filterActivities(activities, sport, year);
  const daySet = new Set(yearly.map(activityDateKey));
  const streak = calculateStreak(activities, sport, year, today);
  return {
    totalDistanceMeters: all.reduce(
      (sum, activity) => sum + activity.distance,
      0
    ),
    totalCount: all.length,
    yearDistanceMeters: yearly.reduce(
      (sum, activity) => sum + activity.distance,
      0
    ),
    yearCount: yearly.length,
    activeDays: daySet.size,
    streakDays: streak.days,
    streakLabel: streak.label,
  };
}

export function buildMonthDistances(
  activities: Activity[],
  sport: string,
  year: number
): MonthDistance[] {
  const months = Array.from({ length: 12 }, (_, month) => ({
    month,
    distanceMeters: 0,
  }));
  for (const activity of filterActivities(activities, sport, year)) {
    const month = Number(activityDateKey(activity).slice(5, 7)) - 1;
    if (month >= 0 && month < 12)
      months[month].distanceMeters += activity.distance;
  }
  return months;
}

export function buildHeatmap(
  activities: Activity[],
  sport: string,
  year: number,
  today = new Date()
): HeatmapGrid {
  const scoped = filterActivities(activities, sport, year);
  const days = new Map<string, { count: number; distance: number }>();
  for (const activity of scoped) {
    const key = activityDateKey(activity);
    const previous = days.get(key) ?? { count: 0, distance: 0 };
    days.set(key, {
      count: previous.count + 1,
      distance: previous.distance + activity.distance,
    });
  }

  const firstDay = new Date(year, 0, 1);
  const lastDay = new Date(year, 11, 31);
  const gridStart = addDays(firstDay, -firstDay.getDay());
  const gridEnd = addDays(lastDay, 6 - lastDay.getDay());
  const totalDays =
    Math.round((gridEnd.getTime() - gridStart.getTime()) / 86400000) + 1;
  const weeks: HeatmapDay[][] = [];
  const maxDistanceMeters = Math.max(
    0,
    ...Array.from(days.values(), (day) => day.distance)
  );
  const todayDateKey = todayKey(today);

  for (let index = 0; index < totalDays; index += 1) {
    const current = addDays(gridStart, index);
    const key = dateKey(
      current.getFullYear(),
      current.getMonth() + 1,
      current.getDate()
    );
    const day = days.get(key) ?? { count: 0, distance: 0 };
    const week = Math.floor(index / 7);
    weeks[week] ??= [];
    weeks[week].push({
      date: key,
      activityCount: day.count,
      distanceMeters: day.distance,
      intensity:
        day.distance > 0 && maxDistanceMeters > 0
          ? Math.max(0.16, Math.sqrt(day.distance / maxDistanceMeters))
          : 0,
      future: key > todayDateKey,
    });
  }

  const monthLabels: { label: string; week: number }[] = [];
  let previousMonth = -1;
  weeks.forEach((week, index) => {
    const first = week.find((day) => day.date.slice(0, 4) === String(year));
    if (!first) return;
    const month = Number(first.date.slice(5, 7));
    if (month !== previousMonth) {
      monthLabels.push({ label: `${month}月`, week: index });
      previousMonth = month;
    }
  });
  return { weeks, monthLabels, maxDistanceMeters };
}
