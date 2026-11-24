// "Is this already on the calendar?" (Nov 24, 2026). Used by the submit form, which checks a new
// event against the site's own search index (/search.json) before it's sent: right after a flyer
// is read, and when someone types an event in by hand.
//
// The calendar's rule for duplicates (SITE.md, "Event pages"): same name, same day, and nothing
// says they're in different places. This is the forgiving version of that rule for people:
// "Jazz Night w/ Bob" matches "Jazz Night with Bob", and a looser name still matches when the
// venue is the same. Same name at a clearly different venue is never a match (five bars can each
// have a Trivia Night on Tuesday). A wrong guess costs the organizer one tap ("No, mine's
// different"), so this leans toward asking.

// Words that don't tell two events apart.
const STOP = new Set(['the', 'a', 'an', 'at', 'and', 'with', 'w', 'live', 'presents', 'present', 'featuring', 'feat', 'ft', 'of', 'in', 'on', 'for', 'by', 'nm', 'new', 'mexico']);

// "Jazz Night w/ Bob!" -> ['jazz', 'night', 'bob']
export function words(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\bw\//g, ' with ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

// 0 to 1: how alike two names are. Half "how much they share", half "is the shorter one inside
// the longer one", so "Trivia Night" vs "Tuesday Trivia Night" scores well.
export function nameScore(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  if ([...A].join('') === [...B].join('')) return 1;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  const union = A.size + B.size - both;
  return (both / union + both / Math.min(A.size, B.size)) / 2;
}

// 'same', 'different' or 'unknown' (no venue on one side).
// `doc` is a search.json entry: v = venue (and room), va = other spellings and keywords.
export function venueMatch(venue, doc) {
  const mine = String(venue || '').split('>')[0];
  if (!words(mine).length || !words(doc.v).length) return 'unknown';
  if (nameScore(mine, doc.v) >= 0.6) return 'same';
  // One of the venue's other spellings ("The Plaza" for "Rio Grande Theatre"...).
  const aka = new Set(words(doc.va));
  const w = words(mine);
  if (w.length && w.filter((x) => aka.has(x)).length / w.length >= 0.8) return 'same';
  return 'different';
}

// Listings on the calendar that look like the same event.
//   event: { title, venue, dates: ['YYYY-MM-DD', ...] }
//   index: the parsed /search.json ({ events: [{ id, t, v, va, dt }] })
// Returns up to 3, best first: { id, title, venue, date, score, more } where "more" is how many
// other upcoming dates the same listing has (a weekly regular, a run of shows).
export function findDuplicates(event, index, today = '') {
  const dates = new Set((event.dates || []).filter(Boolean));
  if (!event.title || !dates.size || !index?.events?.length) return [];
  const hits = [];
  for (const doc of index.events) {
    if (!dates.has(doc.dt)) continue;
    const score = nameScore(event.title, doc.t);
    if (score < 0.5) continue;
    const place = venueMatch(event.venue, doc);
    if (place === 'different') continue;
    if (score >= 0.8 || (place === 'same' && score >= 0.5)) hits.push({ doc, score: score + (place === 'same' ? 0.2 : 0) });
  }
  // One card per listing: the same name at the same venue on several dates is one event.
  const seen = new Map();
  for (const h of hits.sort((a, b) => b.score - a.score || a.doc.dt.localeCompare(b.doc.dt))) {
    const key = words(h.doc.t).join(' ') + '|' + words(h.doc.v).join(' ');
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.values()].slice(0, 3).map(({ doc, score }) => {
    const more = index.events.filter((d) => d !== doc && d.dt >= (today || '') && words(d.t).join(' ') === words(doc.t).join(' ') && words(d.v).join(' ') === words(doc.v).join(' ')).length;
    return { id: doc.id, title: doc.t, venue: doc.v, date: doc.dt, score, more };
  });
}

// The flyer itself was uploaded before for a listing that's on the calendar (the Worker knows by
// the picture's fingerprint). Finds that listing's next date in the index.
export function findByTitle(title, venue, index, today = '') {
  const key = words(title).join(' ');
  if (!key || !index?.events?.length) return null;
  const doc = index.events
    .filter((d) => d.dt >= today && words(d.t).join(' ') === key && venueMatch(venue, d) !== 'different')
    .sort((a, b) => a.dt.localeCompare(b.dt))[0];
  if (!doc) return null;
  const more = index.events.filter((d) => d !== doc && d.dt >= today && words(d.t).join(' ') === key && words(d.v).join(' ') === words(doc.v).join(' ')).length;
  return { id: doc.id, title: doc.t, venue: doc.v, date: doc.dt, score: 2, more };
}
