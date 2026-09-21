import './index.css';
import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import * as polyline from '@mapbox/polyline';
import type { Activity } from '@/types';
import {
  formatDuration,
  formatPace,
  getActivityData,
} from '@/hooks/useActivities';
import { AVATAR } from '@/config';
import siteMetadata from '@/static/site-metadata';
import { RouteMap } from '@/components/RouteMap';
import { useAppearance, type AppearanceMode } from './useAppearance';
import {
  activityDateKey,
  activityTypes,
  buildHeatmap,
  buildMonthDistances,
  filterActivities,
  latestActivityWithRoute,
  latestActivityYear,
  summarizeActivities,
  type HeatmapDay,
  type ShadowSummary,
} from './stats';

const PAGE_SIZE = 6;

const TYPE_LABELS: Record<string, string> = {
  Run: '跑步',
  Ride: '骑行',
  Hike: '徒步',
  Walk: '步行',
  cycling: '骑行',
  running: '跑步',
  Workout: '训练',
  WeightTraining: '力量训练',
  StairStepper: '楼梯机',
  WaterSport: '水上运动',
  Swim: '游泳',
  Rowing: '划船',
  VirtualRide: '虚拟骑行',
  VirtualRun: '虚拟跑步',
};

const APPEARANCE_LABELS: Record<AppearanceMode, string> = {
  light: '浅色',
  dark: '深色',
  system: '系统',
};

function activityTypeLabel(type: string): string {
  if (type === 'all') return '全部运动';
  return TYPE_LABELS[type] ?? type;
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toLocaleString('zh-CN', {
    maximumFractionDigits: 1,
  })} km`;
}

function metricKm(meters: number): ReactNode {
  return (
    <>
      {(meters / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}
      <small> km</small>
    </>
  );
}

function formatDate(date: string): string {
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateRange(years: number[]): string {
  if (!years.length) return '—';
  const first = years.at(-1) ?? years[0];
  return `${first}—${years[0]}`;
}

function formatHeatmapDay(day: HeatmapDay): string {
  if (day.future) return `${day.date} · 尚未到达`;
  if (!day.activityCount) return `${day.date} · 无活动`;
  return `${day.date} · ${day.activityCount} 次 · ${formatKm(day.distanceMeters)}`;
}

function routePath(encoded: string | null): string | null {
  if (!encoded) return null;
  try {
    const decoded = polyline.decode(encoded);
    if (decoded.length < 2) return null;
    const meanLatitude =
      decoded.reduce((sum, [lat]) => sum + lat, 0) / decoded.length;
    const longitudeScale = Math.cos((meanLatitude * Math.PI) / 180);
    const points = decoded
      .map(([lat, lng]) => ({ x: lng * longitudeScale, y: lat }))
      .filter(
        (point) =>
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          Math.abs(point.x) <= 180 &&
          Math.abs(point.y) <= 90
      );
    if (points.length < 2) return null;
    const bounds = points.reduce(
      (current, point) => ({
        minX: Math.min(current.minX, point.x),
        maxX: Math.max(current.maxX, point.x),
        minY: Math.min(current.minY, point.y),
        maxY: Math.max(current.maxY, point.y),
      }),
      { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
    );
    const { minX, maxX, minY, maxY } = bounds;
    const width = Math.max(maxX - minX, 0.000001);
    const height = Math.max(maxY - minY, 0.000001);
    const scale = Math.min(60 / width, 36 / height);
    const offsetX = (72 - width * scale) / 2;
    const offsetY = (48 - height * scale) / 2;
    return points
      .map((point) => {
        const x = offsetX + (point.x - minX) * scale;
        const y = offsetY + (maxY - point.y) * scale;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  } catch {
    return null;
  }
}

const RouteThumb = memo(function RouteThumb({
  activity,
}: {
  activity: Activity;
}) {
  const path = useMemo(
    () => routePath(activity.summary_polyline),
    [activity.summary_polyline]
  );
  return (
    <span className="shadow-route-thumb" aria-hidden="true">
      {path ? (
        <svg viewBox="0 0 72 48" role="presentation">
          <polyline points={path} />
        </svg>
      ) : (
        <span className="shadow-route-empty">—</span>
      )}
    </span>
  );
});

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  return (
    <div className="shadow-metric">
      <span className="shadow-metric-label">{label}</span>
      <strong>{value}</strong>
      {detail && <span className="shadow-metric-detail">{detail}</span>}
    </div>
  );
}

function AppearanceControl({
  mode,
  onChange,
}: {
  mode: AppearanceMode;
  onChange: (mode: AppearanceMode) => void;
}) {
  return (
    <div className="shadow-appearance" role="group" aria-label="外观">
      {(Object.keys(APPEARANCE_LABELS) as AppearanceMode[]).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
        >
          {APPEARANCE_LABELS[option]}
        </button>
      ))}
    </div>
  );
}

function FilterBar({
  year,
  years,
  sport,
  sports,
  onYearChange,
  onSportChange,
}: {
  year: number;
  years: number[];
  sport: string;
  sports: string[];
  onYearChange: (year: number) => void;
  onSportChange: (sport: string) => void;
}) {
  const labelCounts = sports.reduce<Record<string, number>>(
    (counts, option) => {
      const label = activityTypeLabel(option);
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    },
    {}
  );
  return (
    <div className="shadow-filters" aria-label="数据筛选">
      <label>
        <span>年份</span>
        <select
          value={year}
          onChange={(event) => onYearChange(Number(event.target.value))}
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>运动</span>
        <select
          value={sport}
          onChange={(event) => onSportChange(event.target.value)}
        >
          <option value="all">全部运动</option>
          {sports.map((option) => (
            <option key={option} value={option}>
              {labelCounts[activityTypeLabel(option)] > 1
                ? `${activityTypeLabel(option)} · ${option}`
                : activityTypeLabel(option)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function SummaryMetrics({
  summary,
  year,
}: {
  summary: ShadowSummary;
  year: number;
}) {
  return (
    <section className="shadow-metrics" aria-label="跑步统计">
      <Metric
        label="累计距离"
        value={metricKm(summary.totalDistanceMeters)}
        detail="全历史"
      />
      <Metric
        label="活动次数"
        value={summary.totalCount.toLocaleString('zh-CN')}
        detail="全历史"
      />
      <Metric
        label={`${year} 年距离`}
        value={metricKm(summary.yearDistanceMeters)}
        detail={`${summary.yearCount} 次活动`}
      />
      <Metric
        label={summary.streakLabel}
        value={
          <>
            {summary.streakDays}
            <small> 天</small>
          </>
        }
        detail={`${summary.activeDays} 个活动日`}
      />
    </section>
  );
}

function HeatmapPanel({
  grid,
  year,
  selectedDate,
  onSelectDate,
  onClearDate,
  embedded = false,
}: {
  grid: ReturnType<typeof buildHeatmap>;
  year: number;
  selectedDate: string | null;
  onSelectDate: (date: string) => void;
  onClearDate: () => void;
  embedded?: boolean;
}) {
  const gridStyle = {
    '--shadow-weeks': grid.weeks.length,
  } as CSSProperties;
  return (
    <section
      className={[
        'shadow-panel',
        'shadow-heatmap-panel',
        embedded ? 'shadow-panel-embedded' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="shadow-heatmap-title"
    >
      <div className="shadow-panel-heading">
        <div>
          <span className="shadow-eyebrow">{year}</span>
          <h2 id="shadow-heatmap-title">跑步日历</h2>
        </div>
        {selectedDate && (
          <button
            type="button"
            className="shadow-text-button"
            onClick={onClearDate}
          >
            清除日期
          </button>
        )}
      </div>
      <div className="shadow-heatmap" style={gridStyle}>
        <div className="shadow-heatmap-months" aria-hidden="true">
          {grid.monthLabels.map((month) => (
            <span
              key={`${month.label}-${month.week}`}
              style={{ gridColumn: month.week + 1 }}
            >
              {month.label}
            </span>
          ))}
        </div>
        <div className="shadow-heatmap-body">
          <div className="shadow-weekday-labels" aria-hidden="true">
            <span>日</span>
            <span>一</span>
            <span>二</span>
            <span>三</span>
            <span>四</span>
            <span>五</span>
            <span>六</span>
          </div>
          <div className="shadow-heatmap-weeks">
            {grid.weeks.map((week) => (
              <div className="shadow-heatmap-week" key={week[0]?.date}>
                {week.map((day) => {
                  const selected = selectedDate === day.date;
                  const disabled = day.future || day.activityCount === 0;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      disabled={disabled}
                      aria-label={formatHeatmapDay(day)}
                      aria-pressed={selected}
                      title={formatHeatmapDay(day)}
                      className={[
                        'shadow-heatmap-day',
                        day.activityCount ? 'has-activity' : null,
                        selected ? 'is-selected' : null,
                        day.future ? 'is-future' : null,
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={
                        { '--shadow-intensity': day.intensity } as CSSProperties
                      }
                      onClick={() => onSelectDate(day.date)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="shadow-heatmap-legend" aria-hidden="true">
        <span>少</span>
        <i className="level-0" />
        <i className="level-1" />
        <i className="level-2" />
        <i className="level-3" />
        <span>多</span>
      </div>
      <p className="shadow-panel-note">
        点选有活动的日期，地图和活动记录会同步筛选。
      </p>
    </section>
  );
}

function MonthDistancePanel({
  months,
  year,
  embedded = false,
}: {
  months: ReturnType<typeof buildMonthDistances>;
  year: number;
  embedded?: boolean;
}) {
  const maxDistance = Math.max(
    ...months.map((month) => month.distanceMeters),
    1
  );
  return (
    <section
      className={[
        'shadow-panel',
        'shadow-month-panel',
        embedded ? 'shadow-panel-embedded' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      aria-labelledby="shadow-month-title"
    >
      <div className="shadow-panel-heading">
        <div>
          <span className="shadow-eyebrow">{year}</span>
          <h2 id="shadow-month-title">月里程</h2>
        </div>
        <span className="shadow-panel-unit">km</span>
      </div>
      <div className="shadow-month-bars">
        {months.map((month) => (
          <div
            className="shadow-month-bar"
            key={month.month}
            title={`${month.month + 1} 月 · ${formatKm(month.distanceMeters)}`}
          >
            <div className="shadow-month-track">
              <span
                style={{
                  height: `${(month.distanceMeters / maxDistance) * 100}%`,
                }}
              />
            </div>
            <span>{month.month + 1}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const ActivityRow = memo(function ActivityRow({
  activity,
  selected,
  onSelect,
}: {
  activity: Activity;
  selected: boolean;
  onSelect: (activity: Activity) => void;
}) {
  return (
    <tr className={selected ? 'is-selected' : undefined}>
      <td className="shadow-table-route" data-label="路线">
        <RouteThumb activity={activity} />
      </td>
      <td data-label="运动">{activityTypeLabel(activity.type)}</td>
      <td data-label="距离" className="shadow-table-number">
        {formatKm(activity.distance)}
      </td>
      <td data-label="配速" className="shadow-table-number">
        {activity.average_speed > 0
          ? `${formatPace(activity.average_speed)} /km`
          : '—'}
      </td>
      <td data-label="时长">{formatDuration(activity.moving_time)}</td>
      <td data-label="日期">{formatDate(activityDateKey(activity))}</td>
      <td className="shadow-table-action">
        <button
          type="button"
          className="shadow-row-button"
          aria-label={`查看${activity.name || activityTypeLabel(activity.type)}路线`}
          aria-pressed={selected}
          onClick={() => onSelect(activity)}
        >
          {selected ? '已选' : '查看'}
        </button>
      </td>
    </tr>
  );
});

function ActivityTable({
  activities,
  selectedActivity,
  page,
  totalPages,
  onPageChange,
  onSelect,
}: {
  activities: Activity[];
  selectedActivity: Activity | null;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onSelect: (activity: Activity) => void;
}) {
  const pageActivities = activities.slice(
    page * PAGE_SIZE,
    (page + 1) * PAGE_SIZE
  );
  return (
    <section
      id="activities"
      className="shadow-panel shadow-activity-panel"
      aria-labelledby="shadow-activity-title"
    >
      <div className="shadow-panel-heading">
        <div>
          <span className="shadow-eyebrow">
            {activities.length.toLocaleString('zh-CN')} 条记录
          </span>
          <h2 id="shadow-activity-title">最近活动</h2>
        </div>
        <span className="shadow-panel-unit">按日期倒序</span>
      </div>
      <div className="shadow-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">路线</th>
              <th scope="col">运动</th>
              <th scope="col">距离</th>
              <th scope="col">配速</th>
              <th scope="col">时长</th>
              <th scope="col">日期</th>
              <th scope="col">
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageActivities.length ? (
              pageActivities.map((activity) => (
                <ActivityRow
                  key={activity.run_id}
                  activity={activity}
                  selected={selectedActivity?.run_id === activity.run_id}
                  onSelect={onSelect}
                />
              ))
            ) : (
              <tr>
                <td colSpan={7} className="shadow-empty-cell">
                  当前筛选没有活动
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="shadow-pagination">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
          >
            上一页
          </button>
          <span>
            第 {page + 1} / {totalPages} 页
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1}
          >
            下一页
          </button>
        </div>
      )}
    </section>
  );
}

function ShadowFooter() {
  return (
    <footer className="shadow-footer">
      <span>黑影儿 · 每一步，都算数</span>
      <nav aria-label="社交链接">
        {siteMetadata.navLinks.map((link) => (
          <a key={link.name} href={link.url} target="_blank" rel="noreferrer">
            {link.name}
          </a>
        ))}
      </nav>
    </footer>
  );
}

function ShadowTheme() {
  const activities = getActivityData() as Activity[];
  const { mode, dark, setMode } = useAppearance();
  const [fallbackYear] = useState(() => new Date().getFullYear());
  const years = useMemo(
    () =>
      Array.from(
        new Set(
          activities.map((activity) => activity.start_date_local.slice(0, 4))
        )
      )
        .map(Number)
        .sort((a, b) => b - a),
    [activities]
  );
  const filterYears = years.length ? years : [fallbackYear];
  const defaultYear = latestActivityYear(activities, fallbackYear);
  const [year, setYear] = useState(defaultYear);
  const [sport, setSport] = useState('all');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(
    () => latestActivityWithRoute(activities)?.run_id ?? null
  );
  const [page, setPage] = useState(0);
  const sports = useMemo(() => activityTypes(activities), [activities]);
  const summary = useMemo(
    () => summarizeActivities(activities, sport, year),
    [activities, sport, year]
  );
  const heatmap = useMemo(
    () => buildHeatmap(activities, sport, year),
    [activities, sport, year]
  );
  const months = useMemo(
    () => buildMonthDistances(activities, sport, year),
    [activities, sport, year]
  );
  const scopedActivities = useMemo(
    () =>
      filterActivities(activities, sport, year).sort(
        (a, b) =>
          b.start_date_local.localeCompare(a.start_date_local) ||
          b.run_id - a.run_id
      ),
    [activities, sport, year]
  );
  const dayActivities = useMemo(
    () =>
      selectedDate
        ? scopedActivities.filter(
            (activity) => activityDateKey(activity) === selectedDate
          )
        : scopedActivities,
    [scopedActivities, selectedDate]
  );
  const selectedActivity = useMemo(
    () =>
      dayActivities.find(
        (activity) => activity.run_id === selectedActivityId
      ) ?? null,
    [dayActivities, selectedActivityId]
  );
  const totalPages = Math.ceil(dayActivities.length / PAGE_SIZE);
  const mapActivities = selectedActivity ? [selectedActivity] : dayActivities;

  const resetSelection = useCallback(() => {
    setSelectedActivityId(null);
  }, []);
  const changeYear = useCallback((nextYear: number) => {
    setYear(nextYear);
    setPage(0);
    setSelectedDate(null);
    setSelectedActivityId(null);
  }, []);
  const changeSport = useCallback((nextSport: string) => {
    setSport(nextSport);
    setPage(0);
    setSelectedDate(null);
    setSelectedActivityId(null);
  }, []);
  const selectDate = useCallback((date: string) => {
    setSelectedDate((current) => (current === date ? null : date));
    setSelectedActivityId(null);
    setPage(0);
  }, []);
  const selectActivity = useCallback(
    (activity: Activity) => {
      setSelectedActivityId((current) =>
        current === activity.run_id ? null : activity.run_id
      );
      if (selectedDate !== null) setPage(0);
      setSelectedDate(null);
      if (window.matchMedia('(max-width: 720px)').matches) {
        requestAnimationFrame(() =>
          document.getElementById('shadow-map')?.scrollIntoView({
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
              .matches
              ? 'instant'
              : 'smooth',
            block: 'start',
          })
        );
      }
    },
    [selectedDate]
  );

  return (
    <div
      className="shadow-theme"
      data-appearance={dark ? 'dark' : 'light'}
      data-mode={mode}
    >
      <header className="shadow-header">
        <div className="shadow-header-inner">
          <a
            className="shadow-brand"
            href="#overview"
            aria-label="黑影儿的跑步记录"
          >
            {AVATAR ? <img src={AVATAR} alt="黑影儿头像" /> : <span>影</span>}
            <span>黑影儿的跑步记录</span>
          </a>
          <nav className="shadow-nav" aria-label="页面导航">
            <a href="#overview">概览</a>
            <a href="#activities">活动</a>
            <a href="#footprints">足迹</a>
          </nav>
          <AppearanceControl mode={mode} onChange={setMode} />
        </div>
      </header>

      <main className="shadow-main">
        <section id="overview" className="shadow-hero">
          <div>
            <h1>每一步，都算数。</h1>
            <p>{formatDateRange(years)} · 跑过的路，都不会白费</p>
          </div>
          <FilterBar
            year={year}
            years={filterYears}
            sport={sport}
            sports={sports}
            onYearChange={changeYear}
            onSportChange={changeSport}
          />
        </section>

        <SummaryMetrics summary={summary} year={year} />

        <section id="footprints" className="shadow-overview-grid">
          <div id="shadow-map" className="shadow-map-column">
            {selectedDate && (
              <div className="shadow-map-filter">
                <span>
                  {selectedDate} · {activityTypeLabel(sport)}
                </span>
                <button
                  type="button"
                  className="shadow-text-button"
                  onClick={() => setSelectedDate(null)}
                >
                  清除日期
                </button>
              </div>
            )}
            <RouteMap
              activities={mapActivities}
              selectedActivity={selectedActivity}
              dark={dark}
              routeColor={dark ? '#c4ee45' : '#789e13'}
              heading="跑过的地方"
              onClearSelection={resetSelection}
            />
          </div>
          <div className="shadow-side-column">
            <div className="shadow-side-panel">
              <HeatmapPanel
                grid={heatmap}
                year={year}
                selectedDate={selectedDate}
                onSelectDate={selectDate}
                onClearDate={() => {
                  setSelectedDate(null);
                  setPage(0);
                }}
                embedded
              />
              <MonthDistancePanel months={months} year={year} embedded />
            </div>
          </div>
        </section>

        <ActivityTable
          activities={dayActivities}
          selectedActivity={selectedActivity}
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          onSelect={selectActivity}
        />
      </main>
      <ShadowFooter />
    </div>
  );
}

export default ShadowTheme;
