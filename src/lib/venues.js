// One name per venue, whatever spelling the feed used. The list is src/data/venues.json plus the
// edits Charlie makes on the review page (Venues), which the submissions Worker keeps.
//   resolveVenue('Icebox Brewery')                     -> { venue: 'Icebox Brewing Company', room: '', key: 'icebox-brewing-company' }
//   resolveVenue('Munson Senior Center > Studio 2')    -> { venue: 'Munson Senior Center', room: 'Studio 2', ... }
//   resolveVenue('Somewhere new')                      -> { venue: 'Somewhere new', room: '', ... } (unlisted names stay as they are)
import fs from 'node:fs';
import data from '../data/venues.json';
import { INTAKE_URL } from './site.js';
import { fold, venueKey, mergeVenues } from './venue-merge.js';

export { fold, venueKey };

// Charlie's venue edits. Like approved submissions, the build stops if they can't be read: without
// them renamed venues would go back to their old names for a day and merged ones would split.
async function loadEdits() {
  // Local testing: EVENTS_VENUES_FILE=path/to/venues.json
  if (process.env.EVENTS_VENUES_FILE) return JSON.parse(fs.readFileSync(process.env.EVENTS_VENUES_FILE, 'utf8')).venues || [];
  if (process.env.EVENTS_OFFLINE === '1') return [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${INTAKE_URL}/venues.json`, { signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return []; // a Worker from before the Venues screen: nothing to merge
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const edits = (await res.json()).venues || [];
      console.log(`Loaded ${edits.length} venue edits`);
      return edits;
    } catch (err) {
      console.warn(`Venue edits attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('Venue edits unavailable. Stopping the build so the last good site stays up.');
}

// The whole master list: { key, name, aliases, keywords, address, website, about, edited }.
export const venueList = mergeVenues(data.venues, await loadEdits());

const exact = new Map();   // folded spelling -> { venue, room }
const prefixes = [];       // [folded prefix, venue, last word of the prefix]
const info = new Map();    // venue name -> { aliases, keywords, address, website, about }

for (const v of venueList) {
  exact.set(fold(v.name), { venue: v.name, room: '' });
  const names = [];
  for (const a of v.aliases || []) {
    if (typeof a === 'string') { exact.set(fold(a), { venue: v.name, room: '' }); names.push(a); }
    else if (a.alias) { exact.set(fold(a.alias), { venue: v.name, room: a.room || '' }); names.push(a.alias); }
    else if (a.prefix) prefixes.push([fold(a.prefix), v.name, a.prefix.split(/\s+/).pop()]);
  }
  // Two entries can end up with one name (a venue renamed to match another): keep what each one has.
  const had = info.get(v.name);
  info.set(v.name, {
    aliases: [...(had?.aliases || []), ...names], keywords: [...(had?.keywords || []), ...(v.keywords || [])],
    address: had?.address || v.address || '', website: had?.website || v.website || '', about: had?.about || v.about || '',
    dogs: !!(had?.dogs || v.dogs),
    // The address it had before a rename, so /venue/<old>/ can forward to the new page.
    oldKeys: [...(had?.oldKeys || []), ...(v.key !== venueKey(v.name) ? [v.key] : [])],
  });
}

export function resolveVenue(raw = '') {
  let name = raw.replace(/\s+/g, ' ').trim();
  let room = '';
  // "Munson Senior Center > Meeting Room 3": the part after ">" is the room.
  const split = name.split(/\s*>\s*/);
  if (split.length > 1) { name = split[0]; room = split.slice(1).join(' · '); }
  const f = fold(name);
  const hit = exact.get(f);
  if (hit) return { venue: hit.venue, room: room || hit.room, key: venueKey(hit.venue) };
  for (const [p, venue, word] of prefixes) {
    if (f.startsWith(p)) {
      const at = name.toLowerCase().lastIndexOf(word.toLowerCase());
      return { venue, room: room || name.slice(at).trim(), key: venueKey(venue) };
    }
  }
  return { venue: name, room, key: venueKey(name) };
}

// Other spellings and search words for a venue (used by search).
export const venueInfo = (name) => info.get(name) || { aliases: [], keywords: [], address: '', website: '', about: '', dogs: false, oldKeys: [] };
