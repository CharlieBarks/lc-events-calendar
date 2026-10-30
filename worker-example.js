// Example Cloudflare Worker to normalize the City of Las Cruces iCal feed.
// Deploy this separately and have your Astro site (or a build step) consume the JSON it returns.

export default {
  async fetch(request) {
    const icalUrl = 'https://lascruces.gov/events/month/?outlook-ical=1';
    const res = await fetch(icalUrl);
    const text = await res.text();

    const events = [];
    const blocks = text.split('BEGIN:VEVENT');
    for (const block of blocks.slice(1)) {
      const summary = (block.match(/SUMMARY:(.*)/) || [])[1]?.trim();
      const dtstart = (block.match(/DTSTART[^:]*:(.*)/) || [])[1]?.trim();
      const location = (block.match(/LOCATION:(.*)/) || [])[1]?.trim();
      const description = (block.match(/DESCRIPTION:(.*)/) || [])[1]?.trim();
      if (summary && dtstart) {
        events.push({
          title: summary,
          start: dtstart,
          venue: location || 'Las Cruces',
          description: description || '',
          source: 'city-of-las-cruces'
        });
      }
    }

    return new Response(JSON.stringify({ events }, null, 2), {
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }
    });
  }
};