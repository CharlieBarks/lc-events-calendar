// Links to the two sister sites, Las Cruces Live (bands and music venues) and the Las Cruces Art
// Trail (galleries, museums, artists). Each publishes a /directory.json that the build reads:
//   - a live music event whose title names a band on Las Cruces Live shows the band's genres and
//     links to its page ("A. Billy Free · Jazz, Soul & R&B");
//   - an event at a venue listed on either site links to that venue's page there;
//   - an event whose title names a published Art Trail artist links to the artist.
// These links are extras: if a directory can't be read, the build simply goes without them.
import fs from 'node:fs';
import { resolveVenue, fold } from './venues.js';

const DIRECTORIES = {
  live: 'https://lascruceslive.com/directory.json',
  art: 'https://lascrucesarttrail.com/directory.json',
};

async function load(key) {
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
