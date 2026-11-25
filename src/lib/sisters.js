// Links to the two sister sites, Las Cruces Live (bands and music venues) and the Las Cruces Art
// Trail (galleries, museums, artists). Each publishes a /directory.json that the build reads:
//   - a live music event whose title names a band on Las Cruces Live shows the band's genres and
//     links to its page ("A. Billy Free · Jazz, Soul & R&B");
//   - an event at a venue listed on either site links to that venue's page there;
//   - an event whose title names a published Art Trail artist links to the artist.
// These links are extras: if a directory can't be read, the build simply goes without them.
import fs from 'node:fs';
import { resolveVenue, fold } from './venues.js';
import { parseHours } from './hours.js';
import { tidyRepeat } from './repeat.js';

const DIRECTORIES = {
  live: 'https://lascruceslive.com/directory.json',
  art: 'https://lascrucesarttrail.com/directory.json',
};

// Each directory is read once per build: the Art Trail's is used twice (its shows, then the links).
const loaded = {};
const load = (key) => (loaded[key] ||= readDirectory(key));
async function readDirectory(key) {
  // Local testing: EVENTS_DIRECTORY_<KEY>=path/to/directory.json
  const file = process.env[`EVENTS_DIRECTORY_${key.toUpperCase()}`];
  if (file) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (process.env.EVENTS_OFFLINE === '1') return null;
  try {
    const res = await fetch(DIRECTORIES[key], { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`${DIRECTORIES[key]} not read (${err.message}). Building without those links.`);
    return null;
  }
}

// Band names that are also everyday words would match the wrong events ("The Band", "Illusion").
// A name needs 2+ words, or one word of 6+ letters that isn't on this list.
const COMMON = new Set(['the band', 'illusion', 'caliente', 'wildcard', 'creosote', 'desperados', 'highway fm', 'black jack', 'blues boys', 'lush life', 'wolf pack', 'era snow', 'dosage', 'jackal', 'tejas', 'exito', 'calista', 'suavecito', 'teledrama', 'frequencia', 'unlyshed']);
const usable = (name) => {
  const f = fold(name);
  if (!f || COMMON.has(f)) return false;
  return f.includes(' ') ? f.length >= 5 : f.length >= 6;
};
// Whole words only: "Dan Owen" in "Dan Owen Live" yes, in "Jordan Owens" no.
const inTitle = (title, name) => ` ${fold(title)} `.includes(` ${fold(name)} `);

export async function addSisterLinks(events) {
  const [live, art] = await Promise.all([load('live'), load('art')]);
  if (!live && !art) return;
  // Venues are compared by the calendar's own name for them, so every spelling in venues.json counts.
  const venueMap = (list = []) => new Map(list.map((v) => [resolveVenue(v.name).venue, v.url]));
  const liveVenues = venueMap(live?.venues);
  const artVenues = venueMap(art?.venues);
  const acts = (live?.musicians || []).filter((m) => usable(m.name)).sort((a, b) => b.name.length - a.name.length);
  const artists = (art?.artists || []).filter((a) => usable(a.name));
  let actCount = 0;
  for (const e of events) {
    if (liveVenues.has(e.venue)) e.liveVenueUrl = liveVenues.get(e.venue);
    if (artVenues.has(e.venue)) e.artVenueUrl = artVenues.get(e.venue);
    if (e.category === 'live-music') {
      const found = [];
      for (const m of acts) {
        if (found.length >= 3) break;
        // Skip a shorter name inside one already found ("Dusty" in "Dusty Low Band").
        if (inTitle(e.title, m.name) && !found.some((f) => fold(f.name).includes(fold(m.name)))) found.push(m);
      }
      if (found.length) { e.acts = found; actCount++; }
    }
    const who = artists.filter((a) => inTitle(e.title, a.name));
    if (who.length) e.artists = who;
  }
  console.log(`Sister sites: ${actCount} shows matched to Las Cruces Live acts, ${events.filter((e) => e.liveVenueUrl).length} listings at Las Cruces Live venues, ${events.filter((e) => e.artVenueUrl).length} at Art Trail venues`);
}

// "Americana, Country": the genres of the acts on a listing (first two).
export const genreLine = (e) => [...new Set((e.acts || []).flatMap((a) => a.genres))].slice(0, 2).join(', ');

// ---------- Art Trail shows on the calendar (Nov 25, 2026) ----------
// Galleries enter their current show once, on the Art Trail (Notion Art Venues, the venue form or
// their private edit link). Its /directory.json lists them under "exhibitions"; each becomes an
// exhibit here (see "Exhibits and shows that run for a while" in SITE.md): listed once under On now
// for the whole run, its open days and hours read from the gallery's hours (src/lib/hours.js), and
// its reception as its own listing. They arrive like a feed (`feed: 'arttrail'`), so a show the
// organizer also sent through our form shows once, as the form's copy.
export async function artTrailShows(today) {
  const art = await load('art');
  const shows = Array.isArray(art?.exhibitions) ? art.exhibitions : [];
  const out = [];
  for (const s of shows) {
    if (!s?.title || !s.venue || !isDate(s.start)) continue;
    if (s.end && (!isDate(s.end) || s.end < today)) continue;
    const read = parseHours(s.hours);
    const reception = s.reception && isDate(s.reception.date) ? receptionOf(s.reception) : null;
    const repeat = tidyRepeat({
      freq: 'weekly', every: 1, start: s.start, until: s.end || '', exhibit: true,
      days: read ? read.days : [0, 1, 2, 3, 4, 5, 6],
      hours: read ? read.hours : {},
      hoursNote: read ? read.skipped.join('; ') : String(s.hours || ''),
      reception,
    });
    if (!repeat) continue;
    const artists = (s.artists || []).filter(Boolean);
    out.push({
      feed: 'arttrail',
      title: s.title,
      start: s.start,
      end: '',
      venue: s.venue,
      address: s.address || '',
      tags: ['Art', 'Exhibit'],
      price: /^free/i.test(s.admission || '') ? 'Free' : '',
      description: [s.description, artists.length ? `Art Trail artists in this show: ${artists.join(', ')}.` : ''].filter(Boolean).join('\n\n'),
      url: s.url || '',
      image: s.image || '',
      repeat,
      // spread() names each date after this, and the exhibit's page after the title.
      slug: slugify(s.title),
    });
  }
  if (shows.length) console.log(`Art Trail: ${out.length} of ${shows.length} shows on the calendar`);
  return out;
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60).replace(/-$/, '');
// "4–8pm" -> 16:00–20:00 through the same reader as gallery hours (it needs a day, so give it one).
function receptionOf(r) {
  const read = parseHours(`Mon ${r.time || ''}`);
  let t = read?.hours?.[1];
  if (!t) {
    // A start time alone: "2pm", "6:30 pm", "noon".
    const m = String(r.time || '').toLowerCase().replace('noon', '12pm').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (m && Number(m[1]) <= 12) t = { start: `${String((Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0)).padStart(2, '0')}:${m[2] || '00'}`, end: '' };
  }
  return { date: r.date, start: t?.start || '', end: t?.end || '', label: r.label || 'Opening reception' };
}
