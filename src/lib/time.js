// Every event time is shown in Las Cruces time, no matter where the site is built.
// Feeds give "floating" local times (2026-11-07T18:00:00) or real instants (…Z / -07:00).
// We turn both into wall-clock parts {y, m, d, H, M} for America/Denver.

export const TZ = 'America/Denver';

const pad = (n) => String(n).padStart(2, '0');

function partsAt(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour, M: +p.minute };
}

export function wall(iso) {
  if (!iso) return null;
  if (/(Z|[+-]\d\d:?\d\d)$/i.test(iso)) return { ...partsAt(new Date(iso)), allDay: false };
  const m = String(iso).match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3], H: +(m[4] || 0), M: +(m[5] || 0), allDay: !m[4] };
}

// A Date whose UTC fields equal the Las Cruces wall clock. Only format it with timeZone: 'UTC'.
const asUTC = (w) => new Date(Date.UTC(w.y, w.m - 1, w.d, w.H, w.M));
const fmt = (w, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(asUTC(w));

export const dateKey = (w) => `${w.y}-${pad(w.m)}-${pad(w.d)}`;
export const weekday = (w) => fmt(w, { weekday: 'long' });
export const dayLabel = (w) => fmt(w, { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDate = (w) => fmt(w, { weekday: 'short', month: 'short', day: 'numeric' });
export const longDate = (w) => fmt(w, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const monthShort = (w) => fmt(w, { month: 'short' });
export const timeLabel = (w) => (w.allDay ? 'All day' : fmt(w, { hour: 'numeric', minute: '2-digit' }).replace(':00', ''));

export function timeRange(start, end) {
  if (start.allDay) return 'All day';
  if (!end || dateKey(end) !== dateKey(start)) return timeLabel(start);
  const a = timeLabel(start), b = timeLabel(end);
  // "6 – 8:30 PM" instead of "6 PM – 8:30 PM"
  const sameHalf = a.slice(-2) === b.slice(-2);
  return `${sameHalf ? a.slice(0, -3) : a} – ${b}`;
}

// Real ISO with the correct Mountain offset (for schema.org and calendar files).
export function offsetIso(w) {
  const guess = new Date(asUTC(w).getTime() + 7 * 3600e3);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName').value; // "GMT-07:00"
  const off = name.replace('GMT', '') || '+00:00';
  return `${dateKey(w)}T${pad(w.H)}:${pad(w.M)}:00${off}`;
}

export const instant = (w) => new Date(offsetIso(w));

// iCalendar stamp in UTC: 20261107T010000Z
export const icsStamp = (w) => instant(w).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function todayWall(now = new Date()) {
  return { ...partsAt(now), allDay: false };
}

export function addDays(w, n) {
  const d = new Date(Date.UTC(w.y, w.m - 1, w.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: 0, M: 0, allDay: true };
}

// Friday–Sunday of the current weekend (or the next one, Monday–Thursday).
export function weekendRange(today = todayWall()) {
  const dow = asUTC({ ...today, H: 12, M: 0 }).getUTCDay(); // 0 Sun … 6 Sat
  const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
  const fri = addDays(today, toFri);
  return { from: dateKey(fri), to: dateKey(addDays(fri, 2)), fri };
}
