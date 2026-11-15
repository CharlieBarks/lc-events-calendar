// Venue names: one set of rules for the site build and the submissions Worker (intake.js), so a
// venue Charlie edits on the review page means the same thing in both places.
//
// The master list is src/data/venues.json PLUS Charlie's edits (kept by the Worker, read at
// /venues.json). An edit is { key, name, address, website, about, aliases: [spellings], was }.
// "key" is the venue's original key and never changes, so a renamed venue still lines up with
// its entry in venues.json; the old name keeps working as a spelling.

// Lowercase, no accents, no apostrophes or punctuation, "&" = "and": "Madelyn‘s" and "madelyns" match.
export const fold = (s = '') => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const venueKey = (name = '') => fold(name).replace(/ /g, '-');

export function mergeVenues(base = [], edits = []) {
  const out = base.map((v) => ({ aliases: [], keywords: [], ...v, key: venueKey(v.name) }));
  for (const e of edits) {
    if (!e?.key || !e.name) continue;
    const i = out.findIndex((v) => v.key === e.key);
    const prev = i >= 0 ? out[i] : null;
    // Rooms and "starts with" rules can't be edited on the review page: keep them from venues.json.
    const aliases = [...(prev?.aliases || []).filter((a) => typeof a !== 'string'), ...(e.aliases || [])];
    // The name it had before stays as a spelling, so feeds that still use it land on this venue.
    const old = prev?.name || e.was || e.key.replace(/-/g, ' ');
    if (fold(old) !== fold(e.name) && !aliases.some((a) => typeof a === 'string' && fold(a) === fold(old))) aliases.push(old);
    const v = { key: e.key, name: e.name, aliases, keywords: prev?.keywords || [], address: e.address || '', website: e.website || '', about: e.about || '', edited: true };
    if (i >= 0) out[i] = v; else out.push(v);
  }
  return out;
}
