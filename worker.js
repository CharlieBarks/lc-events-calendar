// worker.js — deployed as the "lc-events-proxy" Cloudflare Worker.
// Fetches the City of Las Cruces iCal feed and returns clean JSON for the Astro build.
// lascruces.gov returns 403 to Cloudflare's build servers, but allows Workers, so this proxy is required.
//
// GET /        -> { events: [...] }
// GET /debug   -> event counts for each candidate feed URL (for troubleshooting)

const FEEDS = [
  // Full list view (The Events Calendar plugin). Most events first.
  'https://lascruces.gov/events/list/?ical=1',
  'https://lascruces.gov/events/?ical=1',
  'https://lascruces.gov/events/month/?ical=1',
  // Original URL Grok used. Only exports a single event, kept as last resort.
  'https://lascruces.gov/events/month/?outlook-ical=1',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; LiveLoveLasCruces/1.0; +https://livelovelascruces.com)',
  'Accept': 'text/calendar, text/plain, */*',
};

const JSON_HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/debug') {
      const report = [];
      for (const feed of FEEDS) {
        try {
          const res = await fetch(feed, { headers: HEADERS });
          const text = res.ok ? await res.text() : '';
          report.push({ feed, status: res.status, events: res.ok ? parseICal(text).length : 0 });
        } catch (err) {
          report.push({ feed, error: err.message });
        }
      }
      return new Response(JSON.stringify(report, null, 2), { headers: JSON_HEADERS });
    }

    // Use the first feed that returns the most events.
    let best = { events: [], feed: null, status: null };
    for (const feed of FEEDS) {
      try {
        const res = await fetch(feed, { headers: HEADERS, cf: { cacheTtl: 300 } });
        if (!res.ok) { best.status ??= res.status; continue; }
        const events = parseICal(await res.text());
        if (events.length > best.events.length) best = { events, feed, status: res.status };
        if (events.length > 1) break; // good feed found
      } catch (err) {
        best.error = err.message;
      }
    }

    if (best.events.length === 0) {
      return new Response(JSON.stringify({ error: `No events (upstream ${best.status ?? best.error})`, events: [] }), {
        status: 502,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ source: best.feed, count: best.events.length, events: best.events }, null, 2), {
      headers: { ...JSON_HEADERS, 'cache-control': 'public, max-age=300' },
    });
  },
};

function parseICal(raw) {
  // Unfold wrapped lines (RFC 5545: continuation lines start with a space or tab).
  const text = raw.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  const seen = new Set();

  for (const block of text.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const get = (key) => {
      const match = body.match(new RegExp(`^${key}(?:;[^:\\n]*)?:(.*)$`, 'm'));
      return match
        ? match[1].trim().replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
        : '';
    };

    const summary = get('SUMMARY');
    const dtstart = get('DTSTART');
    if (!summary || !dtstart) continue;

    const start = toIso(dtstart);
    const end = toIso(get('DTEND'));
    const uid = get('UID');

    // UIDs look like "12345-1761900900-1761904500@lascruces.gov" — use the part before "@".
    const idPart = (uid.split('@')[0] || start).replace(/[^a-z0-9]+/gi, '-').slice(-24);
    const base = summary.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
    let slug = `${base}-${idPart}`.replace(/-+/g, '-').replace(/-$/, '');
    if (seen.has(slug)) slug += `-${seen.size}`;
    seen.add(slug);

    events.push({
      slug,
      title: summary,
      start,
      end: end || null,
      venue: get('LOCATION') || 'Las Cruces, NM',
      description: get('DESCRIPTION'),
      url: get('URL') || null,
      image: (body.match(/^ATTACH[^:\n]*:(https?:\/\/.*)$/m) || [])[1]?.trim() || null,
      category: get('CATEGORIES').split(',')[0] || 'Community',
      source: 'city-of-las-cruces',
      featured: false,
    });
  }
  return events;
}

// Local (floating / TZID) times are kept as wall-clock time in Las Cruces.
function toIso(value) {
  if (!value) return '';
  if (/^\d{8}T\d{6}/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}${value.endsWith('Z') ? 'Z' : ''}`;
  }
  if (/^\d{8}$/.test(value)) {
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00`;
  }
  return value;
}
