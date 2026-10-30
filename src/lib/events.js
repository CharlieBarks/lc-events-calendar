// src/lib/events.js
// Fetch and normalize the City of Las Cruces iCal feed at build time.

const ICAL_URL = 'https://lascruces.gov/events/month/?outlook-ical=1';

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
      featured: false,
    });
  }
  return events;
}

export async function getEvents() {
  try {
    const res = await fetch(ICAL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const events = parseICal(text);
    console.log(`Fetched ${events.length} events from city iCal`);
    return events.sort((a, b) => new Date(a.start) - new Date(b.start));
  } catch (err) {
    console.error('Failed to fetch city iCal:', err);
    return [{
      slug: 'fallback',
      title: 'City feed unavailable (using fallback)',
      start: new Date().toISOString(),
      venue: 'Las Cruces, NM',
      description: 'The city iCal could not be loaded at build time.',
      category: 'Community',
      featured: false
    }];
  }
}