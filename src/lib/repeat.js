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
//     skip: ['2026-12-22'],      // single dates taken out
//     // Exhibits and shows that run for a while (Nov 25, 2026). Only kept when set:
//     exhibit: true,             // listed once under "On now" for the whole run, not on every open day
//     hours: { 4: { start: '17:00', end: '20:00' }, 6: { start: '12:00', end: '16:00' } },
//                                // weekly only: each open weekday's own hours (missing = the first date's times)
//     reception: { date: '2026-11-06', start: '17:00', end: '20:00', label: 'Opening reception' } }
//                                // one evening with its own listing on its day
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
  const out = {
    freq, every,
    days: freq === 'weekly' ? days : [],
    by: freq === 'monthly' ? (r.by === 'date' ? 'date' : 'weekday') : '',
    start: r.start,
    until: isDate(r.until) && r.until >= r.start ? r.until : '',
    skip: [...new Set((Array.isArray(r.skip) ? r.skip : []).filter(isDate))].sort().slice(0, 200),
  };
  // Exhibit extras, only when set, so ordinary rules stay exactly as they were.
  if (r.exhibit && freq === 'weekly') out.exhibit = true;
  if (freq === 'weekly' && r.hours && typeof r.hours === 'object') {
    const hours = {};
    for (const d of days) {
      const h = r.hours[d] || r.hours[String(d)];
      if (h && isTime(h.start)) hours[d] = { start: h.start, end: isTime(h.end) ? h.end : '' };
    }
    if (Object.keys(hours).length) out.hours = hours;
  }
  // The venue's own words for anything the open days and hours can't say ("Open during events only",
  // "First Fridays until 7pm"). Art Trail shows, Nov 25, 2026.
  const note = String(r.hoursNote || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (note && freq === 'weekly') out.hoursNote = note;
  const rc = r.reception;
  if (rc && isDate(rc.date)) {
    out.reception = {
      date: rc.date,
      start: isTime(rc.start) ? rc.start : '',
      end: isTime(rc.end) ? rc.end : '',
      label: String(rc.label || '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Opening reception',
    };
  }
  return out;
}

const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

// A rule's hours for one date: that weekday's own hours, or null (use the first date's times).
export function hoursOn(rule, key) {
  const r = tidyRepeat(rule);
  if (!r || !r.hours || !isDate(key)) return null;
  return r.hours[parts(key).w] || null;
}

// "5 PM", "4:30 PM", "noon", "5–8 PM", "noon–4 PM", "10 AM–2 PM".
const clock = (t) => {
  const [H, M] = t.split(':').map(Number);
  if (H === 12 && M === 0) return { text: 'noon', ap: '' };
  return { text: `${H % 12 || 12}${M ? `:${String(M).padStart(2, '0')}` : ''}`, ap: H < 12 ? 'AM' : 'PM' };
};
export function timeSpan(start, end) {
  if (!isTime(start)) return '';
  const a = clock(start);
  if (!isTime(end)) return a.ap ? `${a.text} ${a.ap}` : a.text;
  const b = clock(end);
  const left = a.ap && a.ap === b.ap ? a.text : a.ap ? `${a.text} ${a.ap}` : a.text;
  return `${left}–${b.ap ? `${b.text} ${b.ap}` : b.text}`;
}

// When an exhibit is open, in words: "Thursday and Friday 5–8 PM, Saturday and Sunday noon–4 PM".
// Days with the same hours go together, Monday first; three or more days in a row read "Thursday to Sunday".
export function openHours(rule, fallback = {}) {
  const r = tidyRepeat(rule);
  if (!r || r.freq !== 'weekly') return '';
  // Hours that couldn't be read into days and times: the venue's own words.
  if (r.hoursNote && !r.hours && !fallback.start) return r.hoursNote;
  const said = daysAndHours(r, fallback);
  return r.hoursNote ? `${said}. Also: ${r.hoursNote}` : said;
}
function daysAndHours(r, fallback) {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => r.days.includes(d));
  const span = (d) => { const h = (r.hours && r.hours[d]) || fallback; return timeSpan(h.start, h.end); };
  const groups = [];
  for (const d of order) {
    const s = span(d);
    const last = groups[groups.length - 1];
    if (last && last.s === s) last.days.push(d); else groups.push({ s, days: [d] });
  }
  const names = (ds) => {
    const pos = ds.map((d) => order.indexOf(d));
    const together = ds.length >= 3 && pos.every((p, i) => i === 0 || p === pos[i - 1] + 1) && ds.every((d, i) => i === 0 || (d === 0 ? 7 : d) === (ds[i - 1] === 0 ? 7 : ds[i - 1]) + 1);
    return together ? `${WEEKDAYS[ds[0]]} to ${WEEKDAYS[ds[ds.length - 1]]}` : list(ds.map((d) => WEEKDAYS[d]));
  };
  if (order.length === 7 && groups.length === 1) return `Every day${groups[0].s ? ` ${groups[0].s}` : ''}`;
  return groups.map((g) => `${names(g.days)}${g.s ? ` ${g.s}` : ''}`).join(', ');
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
  if (r.exhibit) {
    // "Exhibit, open Thursday and Friday 5–8 PM, Saturday and Sunday noon–4 PM until Dec 13 (opening reception Nov 6, 5–8 PM)"
    text = `Exhibit, open ${openHours(r)}`;
    if (r.until) { const u = parts(r.until); text += ` until ${MONTHS[u.m]} ${u.d}${u.y !== start.y ? `, ${u.y}` : ''}`; }
    if (r.reception) { const p = parts(r.reception.date); const t = timeSpan(r.reception.start, r.reception.end); text += ` (${r.reception.label.toLowerCase()} ${MONTHS[p.m]} ${p.d}${t ? `, ${t}` : ''})`; }
    return text;
  }
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
