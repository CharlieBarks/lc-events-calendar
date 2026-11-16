// Search index for the search box (src/components/Search). Built with the site, so it is always as
// fresh as the calendar itself: rebuilt daily and after every approval. Short keys keep it small.
import { getEvents } from '../lib/events.js';
import { CATEGORIES } from '../lib/site.js';
import { venueInfo } from '../lib/venues.js';

const snippet = (s = '', n = 220) => s.replace(/\s+/g, ' ').trim().slice(0, n);

export async function GET() {
  const { events } = await getEvents();
  const venues = new Map();
  const docs = events.map((e) => {
    const extra = venueInfo(e.venue);
    if (e.venue) {
      const v = venues.get(e.venueKey) || { n: e.venue, k: e.venueKey, a: extra.aliases, c: 0 };
      v.c++;
      venues.set(e.venueKey, v);
    }
    return {
      id: e.slug,
      t: e.title,
      v: [e.venue, e.room].filter(Boolean).join(' '),
      va: [...extra.aliases, ...extra.keywords].join(' '),
      c: CATEGORIES[e.category]?.name || '',
      // Tags, plus the acts' names and genres from Las Cruces Live (so "americana" finds shows).
      g: [...(e.tags || []), ...(e.acts || []).flatMap((x) => [x.name, ...x.genres])].join(' '),
      d: snippet(e.summary || e.description),
      dt: e.date,
    };
  });
  const body = JSON.stringify({ builtAt: new Date().toISOString(), venues: [...venues.values()].sort((a, b) => b.c - a.c), events: docs });
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}
