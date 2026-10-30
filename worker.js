// worker.js
// Deploy this as a Cloudflare Worker. It fetches the city iCal and returns clean JSON.
// Then point the Astro site at this Worker's URL.

export default {
  async fetch(request) {
    const icalUrl = 'https://lascruces.gov/events/month/?outlook-ical=1';

    try {
      const res = await fetch(icalUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LiveLoveLasCruces/1.0)',
          'Accept': 'text/calendar'
        }
      });

      if (!res.ok) {
        return new Response(JSON.stringify({ error: `Upstream ${res.status}`, events: [] }), {
          status: 502,
          headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
        });
      }

      const text = await res.text();
      const events = parseICal(text);

      return new Response(JSON.stringify({ events }, null, 2), {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=300'
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message, events: [] }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
      });
    }
  }
};

function parseICal(text) {
  const events = [];
  const blocks = text.split('BEGIN:VEVENT');
  for (const block of blocks.slice(1)) {
    const get = (key) => {
      const match = block.match(new RegExp(`${key}[^:]*:(.*)`));
      return match ? match[1].trim().replace(/\\n/g, '\n').replace(/\\,/g, ',') : '';
    };

    const summary = get('SUMMARY');
    const dtstart = get('DTSTART');
    const location = get('LOCATION');
    const description = get('DESCRIPTION');
    const uid = get('UID');

    if (!summary || !dtstart) continue;

    let iso = dtstart;
    if (/^\d{8}T\d{6}/.test(dtstart)) {
      iso = `${dtstart.slice(0,4)}-${dtstart.slice(4,6)}-${dtstart.slice(6,8)}T${dtstart.slice(9,11)}:${dtstart.slice(11,13)}:${dtstart.slice(13,15)}`;
    } else if (/^\d{8}$/.test(dtstart)) {
      iso = `${dtstart.slice(0,4)}-${dtstart.slice(4,6)}-${dtstart.slice(6,8)}T00:00:00`;
    }

    const slug = summary
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60) + '-' + (uid || iso).slice(-8);

    events.push({
      slug,
      title: summary,
      start: iso,
      venue: location || 'Las Cruces, NM',
      description: description || '',
      category: 'Community',
      source: 'city-of-las-cruces',
      featured: false
    });
  }
  return events;
}