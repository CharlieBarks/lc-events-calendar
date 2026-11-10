// One name per venue, whatever spelling the feed used. The list lives in src/data/venues.json.
//   resolveVenue('Icebox Brewery')                     -> { venue: 'Icebox Brewing Company', room: '', key: 'icebox-brewing-company' }
//   resolveVenue('Munson Senior Center > Studio 2')    -> { venue: 'Munson Senior Center', room: 'Studio 2', ... }
//   resolveVenue('Somewhere new')                      -> { venue: 'Somewhere new', room: '', ... } (unlisted names stay as they are)
import data from '../data/venues.json';

// Lowercase, no accents, no apostrophes or punctuation, "&" = "and": "Madelyn‘s" and "madelyns" match.
export const fold = (s = '') => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const venueKey = (name = '') => fold(name).replace(/ /g, '-');

const exact = new Map();   // folded spelling -> { venue, room }
const prefixes = [];       // [folded prefix, venue, last word of the prefix]
const info = new Map();    // venue name -> { aliases, keywords }

for (const v of data.venues) {
  exact.set(fold(v.name), { venue: v.name, room: '' });
  const names = [];
  for (const a of v.aliases || []) {
    if (typeof a === 'string') { exact.set(fold(a), { venue: v.name, room: '' }); names.push(a); }
    else if (a.alias) { exact.set(fold(a.alias), { venue: v.name, room: a.room || '' }); names.push(a.alias); }
    else if (a.prefix) prefixes.push([fold(a.prefix), v.name, a.prefix.split(/\s+/).pop()]);
  }
  info.set(v.name, { aliases: names, keywords: v.keywords || [] });
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
export const venueInfo = (name) => info.get(name) || { aliases: [], keywords: [] };
