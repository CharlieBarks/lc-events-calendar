// Reads opening hours written the way galleries write them on the Las Cruces Art Trail
// ("Tue–Fri 10am–4:30pm, Sat 9am–4:30pm", "Fri-Sun 12-5pm", "All other Fridays 12:00 -5:00",
// "Daily 10am–5pm, closed Sundays") into open weekdays and each day's hours, in the shape of a repeat
// rule's `days` and `hours` (src/lib/repeat.js). Built Nov 25, 2026 for Art Trail shows on the calendar.
//
// parseHours(text) -> { days: [0..6], hours: { <weekday>: { start: 'HH:MM', end: 'HH:MM' } }, skipped: [...] }
// or null when no open days can be read ("Open during events only", "By appointment").
// Special days ("First Fridays until 7pm", "1st Fri 4-8pm") aren't weekly, so they're skipped and
// returned in `skipped` for the event page to mention.

const DAY_WORDS = [
  ['sun', 0], ['mon', 1], ['tue', 2], ['wed', 3], ['thu', 4], ['fri', 5], ['sat', 6],
];
const dayOf = (word) => {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const hit = DAY_WORDS.find(([k]) => w.startsWith(k));
  return hit ? hit[1] : -1;
};
const DAY = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*\\.?';
const SPECIAL = /\b(first|1st|second|2nd|third|3rd|fourth|4th|last)\s+(sun|mon|tue|wed|thu|fri|sat)|\bart\s*walk|\bholiday|\bseason/i;
const NOT_OPEN = /by appointment|appointment only|events? only|call (ahead|for)|varies|being confirmed/i;

// "12-5pm" -> 12:00–17:00, "11–5pm" -> 11:00–17:00, "10:00 -2:00" -> 10:00–14:00, "noon to 4" -> 12:00–16:00.
// Without am/pm, gallery hours read the usual way: 8–11 are mornings, 12 is noon, 1–7 are afternoons.
function timeRange(text) {
  const t = text.toLowerCase().replace(/noon/g, '12:00pm').replace(/midnight/g, '12:00am').replace(/\./g, '');
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:–|—|-|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?/);
  if (!m) return null;
  const mer = (x) => (x ? (x[0] === 'a' ? 'am' : 'pm') : '');
  let [h1, m1, a1, h2, m2, a2] = [Number(m[1]), Number(m[2] || 0), mer(m[3]), Number(m[4]), Number(m[5] || 0), mer(m[6])];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const guess = (h) => (h === 12 ? 'pm' : h >= 8 && h <= 11 ? 'am' : 'pm');
  if (!a2) a2 = h2 > 12 ? '' : guess(h2);
  if (!a1) a1 = h1 > 12 ? '' : a2 && h1 <= h2 && h1 !== 12 && !(a2 === 'pm' && h1 >= 8 && h1 <= 11) ? a2 : guess(h1);
  const to24 = (h, a) => (a === 'am' ? h % 12 : a === 'pm' ? (h % 12) + 12 : h);
  const pad = (n) => String(n).padStart(2, '0');
  const start = `${pad(to24(h1, a1))}:${pad(m1)}`;
  const end = `${pad(to24(h2, a2))}:${pad(m2)}`;
  return start < end ? { start, end } : null;
}

// The weekdays a piece of text names: "Tue–Fri", "Fri to Sun", "Sat & Sun", "Saturdays", "Daily".
function daysIn(text) {
  const t = text.toLowerCase();
  if (/\b(daily|every ?day|7 days)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const days = new Set();
  const range = new RegExp(`\\b${DAY}\\s*(?:–|—|-|to|through|thru)\\s*${DAY}`, 'g');
  let m;
  const used = [];
  while ((m = range.exec(t))) {
    let a = dayOf(m[1]); const b = dayOf(m[2]);
    for (let i = 0; i < 7 && a !== -1; i++) { days.add(a); if (a === b) break; a = (a + 1) % 7; }
    used.push([m.index, m.index + m[0].length]);
  }
  const single = new RegExp(`\\b${DAY}`, 'g');
  while ((m = single.exec(t))) {
    if (used.some(([s, e]) => m.index >= s && m.index < e)) continue;
    const d = dayOf(m[1]);
    if (d !== -1) days.add(d);
  }
  return [...days];
}

export function parseHours(text) {
  const raw = String(text || '').trim();
  if (!raw || NOT_OPEN.test(raw) && !/\d/.test(raw)) return null;
  const parts = raw.split(/\n|;|,(?![^(]*\))|\.(?=\s+[A-Z])/).map((s) => s.trim()).filter(Boolean);
  const hours = {};
  const days = new Set();
  const closed = new Set();
  const skipped = [];
  let waiting = []; // days just named without a time ("Fri to Sun. Noon to 5 pm")
  for (const part of parts) {
    if (SPECIAL.test(part)) { skipped.push(part); waiting = []; continue; }
    if (/\bclosed\b/i.test(part)) { daysIn(part).forEach((d) => closed.add(d)); waiting = []; continue; }
    if (NOT_OPEN.test(part)) { skipped.push(part); waiting = []; continue; }
    const ds = daysIn(part.replace(/\ball other\b/i, ''));
    const time = timeRange(part);
    if (!ds.length) {
      if (time && waiting.length) { waiting.forEach((d) => (hours[d] = time)); waiting = []; }
      else if (/\d/.test(part)) skipped.push(part);
      continue;
    }
    for (const d of ds) {
      days.add(d);
      if (time) hours[d] = time;
    }
    waiting = time ? [] : ds;
  }
  closed.forEach((d) => { days.delete(d); delete hours[d]; });
  if (!days.size) return null;
  return { days: [...days].sort(), hours, skipped };
}
