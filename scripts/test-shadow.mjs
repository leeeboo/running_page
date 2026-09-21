import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import * as ts from 'typescript';

const statsSource = await readFile(
  new URL('../src/themes/shadow/stats.ts', import.meta.url),
  'utf8'
);
const { outputText } = ts.transpileModule(statsSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  },
});
const stats = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

function activity(runId, localStart, distance, type = 'Run') {
  const localDate = localStart.slice(0, 10);
  return {
    run_id: runId,
    name: `${type} ${runId}`,
    distance,
    moving_time: '0:30:00',
    type,
    start_date: `${localDate}T00:00:00.000Z`,
    start_date_local:
      localStart.length === 10 ? `${localStart}T08:00:00` : localStart,
    location_country: null,
    summary_polyline: null,
    average_heartrate: null,
    average_speed: 3,
    elevation_gain: 0,
    source: 'test',
    streak: 0,
  };
}

const activities = [
  activity(1, '2024-01-01', 1500),
  activity(2, '2024-01-01', 500),
  activity(3, '2024-01-02', 2000),
  activity(4, '2024-01-04', 1000),
  activity(5, '2024-02-29T23:30:00-08:00', 3000),
  activity(6, '2024-12-31', 900),
  activity(7, '2025-01-01', 1100),
  activity(8, '2025-01-02', 1200),
  activity(9, '2024-01-02', 8000, 'Ride'),
];
const frozenActivities = Object.freeze(
  activities.map((item) => Object.freeze({ ...item }))
);
const before = JSON.stringify(frozenActivities);
const todayAtYearBoundary = new Date(2025, 0, 2, 12);

const checks = [
  [
    'aggregate meters, sport, and year filters',
    () => {
      const summary = stats.summarizeActivities(
        frozenActivities,
        'Run',
        2024,
        todayAtYearBoundary
      );
      assert.equal(summary.totalDistanceMeters, 11200);
      assert.equal(summary.totalCount, 8);
      assert.equal(summary.yearDistanceMeters, 8900);
      assert.equal(summary.yearCount, 6);
      assert.equal(summary.activeDays, 5);
      assert.equal(summary.streakDays, 2);
      assert.equal(summary.streakLabel, '该年最长连续');
      assert.equal(summary.totalDistanceMeters / 1000, 11.2);
      assert.equal(
        stats.filterActivities(frozenActivities, 'Ride', 2024).length,
        1
      );
    },
  ],
  [
    'duplicate activities on one day count once in a streak',
    () => {
      assert.deepEqual(
        stats.calculateStreak(
          frozenActivities,
          'Run',
          2024,
          todayAtYearBoundary
        ),
        { days: 2, label: '该年最长连续' }
      );
    },
  ],
  [
    'current streak crosses the year boundary',
    () => {
      assert.deepEqual(
        stats.calculateStreak(
          frozenActivities,
          'Run',
          2025,
          todayAtYearBoundary
        ),
        { days: 3, label: '当前连续' }
      );
    },
  ],
  [
    'latest year ignores fallback when data is non-empty',
    () => {
      assert.equal(
        stats.latestActivityYear([activity(10, '2022-06-01', 1)], 2025),
        2022
      );
      assert.equal(stats.latestActivityYear([], 2025), 2025);
    },
  ],
  [
    'month totals and empty data are stable',
    () => {
      const months = stats.buildMonthDistances(frozenActivities, 'Run', 2024);
      assert.equal(months.length, 12);
      assert.equal(months[0].distanceMeters, 5000);
      assert.equal(months[1].distanceMeters, 3000);
      assert.equal(months[11].distanceMeters, 900);
      assert.ok(
        months.slice(2, 11).every((month) => month.distanceMeters === 0)
      );

      const empty = stats.summarizeActivities(
        [],
        'Run',
        2024,
        todayAtYearBoundary
      );
      assert.deepEqual(empty, {
        totalDistanceMeters: 0,
        totalCount: 0,
        yearDistanceMeters: 0,
        yearCount: 0,
        activeDays: 0,
        streakDays: 0,
        streakLabel: '该年最长连续',
      });
      assert.equal(
        stats
          .buildMonthDistances([], 'Run', 2024)
          .every((month) => month.distanceMeters === 0),
        true
      );
    },
  ],
  [
    'heatmap keeps local dates, leap day, boundaries, and future markers',
    () => {
      const grid = stats.buildHeatmap(
        frozenActivities,
        'Run',
        2024,
        new Date(2024, 0, 1, 12)
      );
      const days = grid.weeks.flat();
      const byDate = new Map(days.map((day) => [day.date, day]));
      assert.equal(grid.weeks.length, 53);
      assert.ok(grid.weeks.every((week) => week.length === 7));
      assert.equal(grid.maxDistanceMeters, 3000);
      assert.deepEqual(byDate.get('2024-01-01'), {
        date: '2024-01-01',
        activityCount: 2,
        distanceMeters: 2000,
        intensity: Math.sqrt(2 / 3),
        future: false,
      });
      assert.equal(byDate.get('2024-02-29').activityCount, 1);
      assert.equal(byDate.get('2024-02-29').distanceMeters, 3000);
      assert.equal(byDate.get('2024-02-29').future, true);
      assert.equal(byDate.get('2024-12-31').future, true);
      assert.equal(byDate.get('2023-12-31').future, false);
    },
  ],
  [
    'all helpers leave the input array untouched',
    () => {
      stats.activityTypes(frozenActivities);
      stats.latestActivityYear(frozenActivities, 2025);
      stats.latestActivityWithRoute(frozenActivities, 'Run', 2024);
      stats.filterActivities(frozenActivities, 'Run', 2024);
      stats.calculateStreak(frozenActivities, 'Run', 2024, todayAtYearBoundary);
      stats.summarizeActivities(
        frozenActivities,
        'Run',
        2024,
        todayAtYearBoundary
      );
      stats.buildMonthDistances(frozenActivities, 'Run', 2024);
      stats.buildHeatmap(frozenActivities, 'Run', 2024, todayAtYearBoundary);
      assert.equal(JSON.stringify(frozenActivities), before);
    },
  ],
];

const failures = [];
for (const [name, check] of checks) {
  try {
    check();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`not ok - ${name}`);
    console.error(error.stack ?? error);
  }
}

if (failures.length) {
  throw new Error(`${failures.length} shadow regression check(s) failed`);
}
console.log(`passed ${checks.length} shadow regression checks`);
