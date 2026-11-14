// Repeating events: "every Tuesday", "every other Friday", "the 2nd Saturday of the month".
//
// Used in three places, so the rule means the same thing everywhere:
//   - the add-your-event form (src/pages/submit.astro) to preview the dates,
//   - the submissions Worker (intake.js) to check and describe a rule,
//   - the site build (src/lib/events.js) to turn a rule into dated listings.
//
// A rule:
//   { freq: 'weekly' | 'monthly',
//     every: 1,                  // every N weeks or months
//     days: [2, 4],              // weekly only: 0 = Sunday … 6 = Saturday. Empty = the start date's weekday
//     by: 'weekday' | 'date',    // monthly only: "the 2nd Tuesday" or "the 17th"
//     start: '2026-11-17',       // first date (also sets the weekday / day of month)
//     until: '2027-01-16',       // last possible date, '' = no end
//     skip: ['2026-12-22'] }     // single dates taken out
//
// Everything is plain calendar dates (YYYY-MM-DD) in Las Cruces. No clock times and no time
// zones are involved, so daylight saving time can't move a date.

const DAY = 864e5;
const toNum = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
const toKey = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const parts = (key) => { const d = new Date(toNum(key) * DAY); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), w: d.getUTCDay() }; };
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toKey(toNum(s)) === s;

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ORDINAL = ['', '1st', '2nd', '3rd', '4th', 'last'];
const nth = (n) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

const isLastOfMonth = (p) => p.d + 7 > daysInMonth(p.y, p.m);

// Cleans up a rule from a form or a file. Returns null when it isn't a usable rule.
export function tidyRepeat(r) {
  if (!r || typeof r !== 'object' || !isDate(r.start)) return null;
  const freq = r.freq === 'monthly' ? 'monthly' : 'weekly';
  const every = Math.min(Math.max(parseInt(r.every, 10) || 1, 1), 12);
  const startDay = parts(r.start).w;
  let days = [...new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (freq === 'weekly' && !days.length) days = [startDay];
  return {
    freq, every,
    days: freq === 'weekly' ? days : [],
    by: freq === 'monthly' ? (r.by === 'date' ? 'date' : 'weekday') : '',
    start: r.start,
    until: isDate(r.until) && r.until >= r.start ? r.until : '',
    skip: [...new Set((Array.isArray(r.skip) ? r.skip : []).filter(isDate))].sort().slice(0, 200),
  };
}

function matches(rule, key, start) {
  const p = parts(key);
  if (rule.freq === 'weekly') {
    if (!rule.days.includes(p.w)) return false;
    // Weeks are counted Sunday to Saturday from the start date's week.
    const week = (k) => Math.floor((toNum(k) - parts(k).w) / 7);
    return (week(key) - week(rule.start)) % rule.every === 0;
  }
  const months = (p.y - start.y) * 12 + (p.m - start.m);
  if (months % rule.every !== 0) return false;
  if (rule.by === 'date') return p.d === start.d;
  if (p.w !== start.w) return false;
  // "The 5th Tuesday" doesn't exist every month, so a start on a 5th means "the last one".
  return Math.ceil(start.d / 7) >= 5 ? isLastOfMonth(p) : Math.ceil(p.d / 7) === Math.ceil(start.d / 7);
}

// Every date the rule lands on between two dates (both included), oldest first.
export function expand(rule, from, to, max = 400) {
  const r = tidyRepeat(rule);
  if (!r || !isDate(from) || !isDate(to)) return [];
  const start = parts(r.start);
  const skip = new Set(r.skip);
  const first = Math.max(toNum(r.start), toNum(from));
  const last = Math.min(r.until ? toNum(r.until) : Infinity, toNum(to));
  const out = [];
  for (let n = first; n <= last && out.length < max; n++) {
    const key = toKey(n);
    if (!skip.has(key) && matches(r, key, start)) out.push(key);
  }
  return out;
}

const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// "Every Tuesday", "Every other Friday", "Monthly on the 2nd Saturday", "… until Jan 16".
export function describe(rule) {
  const r = tidyRepeat(rule);
  if (!r) return '';
  const start = parts(r.start);
  let text;
  if (r.freq === 'weekly') {
    const names = list(r.days.map((d) => WEEKDAYS[d]));
    text = r.days.length === 7 && r.every === 1 ? 'Every day'
      : r.every === 1 ? `Every ${names}`
      : r.every === 2 ? `Every other ${names}`
      : `Every ${r.every} weeks on ${names}`;
  } else {
    const what = r.by === 'date' ? `the ${nth(start.d)}` : `the ${ORDINAL[Math.min(Math.ceil(start.d / 7), 5)]} ${WEEKDAYS[start.w]}`;
    text = r.every === 1 ? `Monthly on ${what}` : r.every === 2 ? `Every other month on ${what}` : `Every ${r.every} months on ${what}`;
  }
  if (r.until) { const u = parts(r.until); text += ` until ${MONTHS[u.m]} ${u.d}${u.y !== start.y ? `, ${u.y}` : ''}`; }
  return text;
}

// The two ways a monthly rule can read for a given start date, for the form's choices.
export function monthlyChoices(startKey) {
  if (!isDate(startKey)) return { weekday: '', date: '' };
  const p = parts(startKey);
  return { weekday: `The ${ORDINAL[Math.min(Math.ceil(p.d / 7), 5)]} ${WEEKDAYS[p.w]} of the month`, date: `The ${nth(p.d)} of the month` };
}

export const addDaysKey = (key, n) => toKey(toNum(key) + n);

// iCalendar RRULE for a rule (calendar apps then repeat the event themselves).
export function rrule(rule) {
  const r = tidyRepeat(rule);
  if (!r) return '';
  const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const start = parts(r.start);
  const bits = [`FREQ=${r.freq.toUpperCase()}`, `INTERVAL=${r.every}`];
  if (r.freq === 'weekly') bits.push(`BYDAY=${r.days.map((d) => BY[d]).join(',')}`);
  else if (r.by === 'date') bits.push(`BYMONTHDAY=${start.d}`);
  else bits.push(`BYDAY=${Math.ceil(start.d / 7) >= 5 ? -1 : Math.ceil(start.d / 7)}${BY[start.w]}`);
  if (r.until) bits.push(`UNTIL=${r.until.replace(/-/g, '')}T235959`);
  return bits.join(';');
}
