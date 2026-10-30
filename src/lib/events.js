// src/lib/events.js
// Fetch events from the Cloudflare Worker proxy at build time.

// lc-events-proxy Worker (source: worker.js). lascruces.gov blocks Cloudflare build servers directly, so we go through it.
const EVENTS_URL = 'https://lc-events-proxy.cf2-99b.workers.dev';

export async function getEvents() {
  try {
    const res = await fetch(EVENTS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const events = data.events || [];
    console.log(`Fetched ${events.length} events from proxy`);
    if (events.length === 0) throw new Error('No events returned');
    return events.sort((a, b) => new Date(a.start) - new Date(b.start));
  } catch (err) {
    console.error('Failed to fetch events:', err);
    return [{
      slug: 'fallback',
      title: 'City feed unavailable (using fallback)',
      start: new Date().toISOString(),
      venue: 'Las Cruces, NM',
      description: 'Could not reach the events proxy. Deploy the Worker and update EVENTS_URL.',
      category: 'Community',
      featured: false
    }];
  }
}